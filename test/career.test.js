import test from "node:test";
import assert from "node:assert/strict";
import { acknowledgeReport, createGame, settleWeek, updatePlan } from "../src/domain/engine.js";
import { TUTORIAL_STEPS, acknowledgeTutorialStep, continueAfterRetrospective, endCareer, evaluateCareerGoal, skipTutorial } from "../src/domain/career.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };
function game(seed = "career", careerGoal = "livelihood") {
  return createGame({ mode: "direct", routeId: "indie", performerCode: "CAREER", characterName: "生涯测试", primaryLanguage: "jp", primaryDirection: "creative", careerGoal, seed, abilities });
}

test("tutorial is skippable and its reward is granted once across all six first-four-week steps", () => {
  let state = game("tutorial");
  const before = BigInt(state.cash.free);
  for (const stepId of TUTORIAL_STEPS) {
    const result = acknowledgeTutorialStep(state, { stepId, date: "2026-09-14" });
    assert.equal(result.ok, true);
    state = result.state;
  }
  assert.equal(state.tutorial.rewardGranted, true);
  assert.equal(BigInt(state.cash.free), before + 30000n);
  assert.equal(state.history.journalEntries.filter((entry) => entry.sourceType === "TUTORIAL_EFFECT").length, 1);
  const replay = acknowledgeTutorialStep(state, { stepId: TUTORIAL_STEPS.at(-1), date: "2026-09-14" });
  assert.equal(BigInt(replay.state.cash.free), before + 30000n);
  const skipped = skipTutorial(game("tutorial-skip"));
  assert.equal(skipped.state.tutorial.skipped, true);
  assert.equal(skipped.state.tutorial.rewardGranted, false);
});

test("schedule and published content advance tutorial from real player actions", async () => {
  let state = game("tutorial-actions");
  const scheduled = updatePlan(state, 0, "LIVE_GAME");
  assert.equal(scheduled.ok, true);
  assert.ok(scheduled.state.tutorial.completedSteps.includes("SCHEDULE"));
  const withVideo = updatePlan(scheduled.state, 1, "MAKE_SHORT");
  const settled = await settleWeek(withVideo.state);
  assert.ok(settled.state.tutorial.completedSteps.includes("FIRST_LIVE"));
  assert.ok(settled.state.tutorial.completedSteps.includes("FIRST_VIDEO"));
});

test("livelihood evaluation excludes game rewards and requires eight sustainable weeks", () => {
  const state = game("livelihood");
  state.history.weeklyReports = Array.from({ length: 8 }, (_, index) => ({ weekIndex: index + 1, state: { stress: 50 } }));
  state.weekIndex = 8;
  state.cash.free = "1000000";
  state.history.journalEntries.push({ id: "reward", date: "2026-10-01", sourceType: "TUTORIAL_EFFECT", lines: [{ account: "CASH_FREE", debit: "999999", credit: "0" }, { account: "GAME_REWARD", debit: "0", credit: "999999" }] });
  let result = evaluateCareerGoal(state);
  assert.equal(result.achieved, false);
  assert.equal(result.measures.incomeTotalJpy, "0");
  for (let index = 0; index < 8; index += 1) state.history.journalEntries.push({ id: `income_${index}`, date: `2026-10-${String(index + 1).padStart(2, "0")}`, lines: [{ account: "CASH_FREE", debit: "30000", credit: "0" }, { account: "OTHER_INCOME", debit: "0", credit: "30000" }] });
  result = evaluateCareerGoal(state);
  assert.equal(result.achieved, true);
  assert.equal(result.measures.averageStress, 50);
  assert.equal(result.measures.fulfillmentRate, 100);
});

test("A-40 week 104 generates a retained retrospective before explicitly continuing into week 105", async () => {
  const state = game("week-104", "creator");
  state.weekIndex = 104;
  state.eventWeeksProcessed.push(104);
  state.textEvents = [];
  const settled = await settleWeek(state);
  assert.equal(settled.state.phase, "REPORT");
  const acknowledged = acknowledgeReport(settled.state);
  assert.equal(acknowledged.ok, true);
  assert.equal(acknowledged.state.phase, "RETROSPECTIVE");
  assert.equal(acknowledged.state.weekIndex, 104);
  assert.equal(acknowledged.state.careerRetrospectives.length, 1);
  const retrospective = acknowledged.state.careerRetrospectives[0];
  assert.ok(retrospective.works && retrospective.collaborations && retrospective.transfers && retrospective.incomeStructure && retrospective.healthLoad && retrospective.keyChoices);
  const continued = continueAfterRetrospective(acknowledged.state);
  assert.equal(continued.ok, true);
  assert.equal(continued.state.weekIndex, 105);
  assert.equal(continued.state.phase, "PLANNING");
  assert.equal(continued.state.careerRetrospectives[0].id, retrospective.id);
});

test("the player may voluntarily end at the retrospective without losing history", async () => {
  const state = game("career-ending", "community");
  state.weekIndex = 104;
  state.eventWeeksProcessed.push(104);
  state.textEvents = [];
  const settled = await settleWeek(state);
  const acknowledged = acknowledgeReport(settled.state);
  const ended = endCareer(acknowledged.state, { outcomeId: "PART_TIME", date: "2028-09-10" });
  assert.equal(ended.ok, true);
  assert.equal(ended.state.phase, "CAREER_ENDED");
  assert.equal(ended.state.careerEnding.outcomeId, "PART_TIME");
  assert.equal(ended.state.careerEnding.voluntary, true);
  assert.equal(ended.state.careerRetrospectives.length, 1);
  assert.equal(endCareer(state, { outcomeId: "GRADUATION", date: "2028-09-10" }).ok, false);
});
