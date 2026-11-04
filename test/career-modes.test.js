import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { acknowledgeReport, createDefaultPlan, createGame, migrateGame, repeatPreviousPlan, settleWeek, updatePlan } from "../src/domain/engine.js";
import { continueAfterRetrospective, endCareer, evaluateCareerGoal, nextCareerReviewWeek } from "../src/domain/career.js";
import { buildSavePackage, canonicalStringify, sha256Hex, validateGameState, validateSavePackage } from "../src/storage.js";
import { CAREER_MODES } from "../rules/career_modes.js";
import { RULESET_MANIFEST } from "../rules/ruleset_manifest.js";
import { runTrajectory } from "../scripts/simulation.mjs";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };
function game(seed, { careerModeId, careerGoal = "creator" } = {}) {
  return createGame({ mode: "direct", routeId: "indie", performerCode: "MODE", characterName: "模式测试", primaryLanguage: "jp", primaryDirection: "creative", careerGoal, careerModeId, seed, abilities });
}

async function settleAndAcknowledge(state, weekIndex) {
  state.weekIndex = weekIndex;
  state.eventWeeksProcessed.push(weekIndex);
  state.textEvents = [];
  const settled = await settleWeek(state);
  assert.equal(settled.state.phase, "REPORT");
  return acknowledgeReport(settled.state);
}

test("career mode ruleset bytes match the manifest and standard thresholds match the frozen evaluator", async () => {
  const hash = createHash("sha256").update(await readFile("rules/career_modes.js")).digest("hex");
  assert.equal(hash, RULESET_MANIFEST.careerModes.sha256);
  assert.equal(RULESET_MANIFEST.careerModes.id, CAREER_MODES.id);
  assert.deepEqual(CAREER_MODES.modes.standard.reviewWeeks, [104]);
  assert.deepEqual(CAREER_MODES.modes.short.reviewWeeks, [26, 104]);
  assert.equal(CAREER_MODES.modes.standard.goalThresholds.creator.portfolioCount, 3);
});

test("new games default to the standard career and unknown modes fall back to it", () => {
  assert.equal(game("mode-default").careerMode, "standard");
  assert.equal(game("mode-unknown", { careerModeId: "__proto__" }).careerMode, "standard");
  const short = game("mode-short", { careerModeId: "short" });
  assert.equal(short.careerMode, "short");
  assert.equal(short.rulesets.careerModes, CAREER_MODES.id);
  assert.equal(nextCareerReviewWeek(short), 26);
});

test("legacy saves without a career mode migrate to the standard 104-week career", () => {
  const legacy = game("mode-legacy");
  delete legacy.careerMode;
  delete legacy.rulesets.careerModes;
  validateGameState(legacy);
  const migrated = migrateGame(legacy);
  assert.equal(migrated.careerMode, "standard");
  assert.equal(migrated.rulesets.careerModes, CAREER_MODES.id);
  assert.equal(nextCareerReviewWeek(migrated), 104);
});

test("a short career generates a half-year retrospective at week 26 and a second one at week 104", async () => {
  const acknowledged = await settleAndAcknowledge(game("short-26", { careerModeId: "short" }), 26);
  assert.equal(acknowledged.ok, true);
  assert.equal(acknowledged.state.phase, "RETROSPECTIVE");
  assert.equal(acknowledged.state.weekIndex, 26);
  const first = acknowledged.state.careerRetrospectives[0];
  assert.equal(first.id, "career_retrospective_26");
  assert.equal(first.throughWeek, 26);
  assert.equal(first.careerMode, "short");
  assert.equal(first.goalEvaluation.careerMode, "short");

  const continued = continueAfterRetrospective(acknowledged.state);
  assert.equal(continued.ok, true);
  assert.equal(continued.state.weekIndex, 27);
  assert.equal(continued.state.phase, "PLANNING");
  assert.equal(nextCareerReviewWeek(continued.state), 104);

  const final = await settleAndAcknowledge(continued.state, 104);
  assert.equal(final.state.phase, "RETROSPECTIVE");
  assert.deepEqual(final.state.careerRetrospectives.map((item) => item.id), ["career_retrospective_26", "career_retrospective_104"]);
  assert.equal(nextCareerReviewWeek(continueAfterRetrospective(final.state).state), null);
});

test("a standard career does not stop at week 26", async () => {
  const acknowledged = await settleAndAcknowledge(game("standard-26"), 26);
  assert.equal(acknowledged.state.phase, "PLANNING");
  assert.equal(acknowledged.state.weekIndex, 27);
  assert.equal(acknowledged.state.careerRetrospectives.length, 0);
});

test("a short career may be archived at week 26 with the ending tied to that week", async () => {
  const acknowledged = await settleAndAcknowledge(game("short-end", { careerModeId: "short" }), 26);
  const ended = endCareer(acknowledged.state, { outcomeId: "PAUSE", date: "2027-03-14" });
  assert.equal(ended.ok, true);
  assert.equal(ended.state.careerEnding.throughWeek, 26);
  assert.equal(ended.state.careerEnding.retrospectiveId, "career_retrospective_26");
});

test("short-career goal thresholds are lowered only where 26 weeks constrain calendar time", () => {
  const withOneWork = (state) => {
    state.history.portfolioWorks = [{ id: "portfolio_one" }];
    state.history.contents = Array.from({ length: 8 }, (_, index) => ({ id: `content_${index}`, actionId: index % 2 ? "LIVE_GAME" : "MAKE_SHORT" }));
    return state;
  };
  assert.equal(evaluateCareerGoal(withOneWork(game("creator-standard"))).achieved, false);
  const short = evaluateCareerGoal(withOneWork(game("creator-short", { careerModeId: "short" })));
  assert.equal(short.achieved, true);
  assert.equal(short.thresholds.portfolioCount, 1);

  const stage = (modeId) => {
    const state = game(`stage-${modeId}`, { careerModeId: modeId, careerGoal: "stage" });
    state.history.contents = Array.from({ length: 6 }, (_, index) => ({ id: `music_${index}`, actionId: "LIVE_MUSIC" }));
    state.collaborationHistory = [{ npcId: "npc_a" }];
    state.performer.abilities.performance = 56;
    return evaluateCareerGoal(state).achieved;
  };
  assert.equal(stage("standard"), false);
  assert.equal(stage("short"), true);
  assert.deepEqual(CAREER_MODES.modes.short.goalThresholds.brand, CAREER_MODES.modes.standard.goalThresholds.brand);
  assert.deepEqual(CAREER_MODES.modes.short.goalThresholds.livelihood, CAREER_MODES.modes.standard.goalThresholds.livelihood);
});

test("repeating last week's plan revalidates every slot and keeps flexible life slots as life", async () => {
  let state = game("repeat-plan");
  assert.equal(repeatPreviousPlan(state).code, "REQUIREMENT_UNMET");
  state = updatePlan(state, 0, "LIVE_GAME").state;
  state = updatePlan(state, 2, "PART_TIME").state;
  state = updatePlan(state, 5, "MAKE_SHORT", { confirmFlexibleLife: true }).state;
  state = updatePlan(state, 6, "REST").state;
  state.eventWeeksProcessed.push(1);
  state.textEvents = [];
  const executed = structuredClone(state.plan);
  const settled = await settleWeek(state);
  const next = acknowledgeReport(settled.state).state;
  assert.deepEqual(next.previousPlan, executed);
  assert.deepEqual(next.plan, createDefaultPlan());

  // 伪造一个已失效的商单绑定，确认它会被跳过而不是带入新周。
  next.previousPlan[7] = { ...next.previousPlan[7], actionId: "EDIT_VIDEO", targetId: "sponsor_missing", targetType: "SPONSOR" };
  const repeated = repeatPreviousPlan(next);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.state.snapshotVersion, next.snapshotVersion + 1);
  assert.equal(repeated.state.plan[0].actionId, "LIVE_GAME");
  assert.equal(repeated.state.plan[2].actionId, "PART_TIME");
  assert.equal(repeated.state.plan[3].actionId, "PART_TIME");
  assert.equal(repeated.state.plan[2].pairId, repeated.state.plan[3].pairId);
  assert.equal(repeated.state.plan[5].actionId, "LIFE");
  assert.equal(repeated.state.plan[5].flexibleLife, true);
  assert.equal(repeated.state.plan[6].actionId, "REST");
  assert.equal(repeated.state.plan[7].actionId, null);
  assert.equal(repeated.summary.copied, 3);
  assert.deepEqual(repeated.summary.skipped.map((item) => [item.slotIndex, item.code]), [[5, "LIFE_CONFIRM_REQUIRED"], [7, "CONTRACT_CONFLICT"]]);
});

test("save packages declare the career mode ruleset; legacy packages load only as standard careers", async () => {
  const short = game("package-short", { careerModeId: "short" });
  const payload = await buildSavePackage(short, "2026-09-14T00:00:00.000Z");
  assert.deepEqual(payload.manifest.rulesets.careerModes, RULESET_MANIFEST.careerModes);
  assert.equal((await validateSavePackage(JSON.parse(JSON.stringify(payload)))).careerMode, "short");

  const legacyShort = JSON.parse(JSON.stringify(payload));
  delete legacyShort.manifest.rulesets.careerModes;
  await assert.rejects(validateSavePackage(legacyShort), /careerModes/);

  const legacyStandard = JSON.parse(JSON.stringify(await buildSavePackage(game("package-legacy"), "2026-09-14T00:00:00.000Z")));
  delete legacyStandard.manifest.rulesets.careerModes;
  delete legacyStandard.game.careerMode;
  delete legacyStandard.game.rulesets.careerModes;
  legacyStandard.checksum.value = await sha256Hex(canonicalStringify(legacyStandard.game));
  assert.equal((await validateSavePackage(legacyStandard)).careerMode, undefined);

  const unknown = game("package-unknown");
  unknown.careerMode = "marathon";
  assert.throws(() => validateGameState(unknown), /生涯模式/);
});

test("a real short-career trajectory reaches its week-26 retrospective with valid state", { timeout: 30_000 }, async () => {
  const result = await runTrajectory({ routeId: "indie", strategyId: "conservative", seed: "short-career-26", weeks: 26, careerModeId: "short", validateEveryWeek: true });
  assert.equal(result.careerModeId, "short");
  assert.equal(result.finalPhase, "RETROSPECTIVE");
  assert.equal(result.checkpoints[26].projectDefaults, 0);
});

test("browser Web Crypto digests (bare ArrayBuffer) produce the same draw as Node buffers", async () => {
  const { deterministicRandom, uniformFromDigest } = await import("../src/domain/random.js");
  const scope = ["seed", 3, "system", "entity", 0].join("/");
  const nodeDigest = createHash("sha256").update(scope, "utf8").digest();
  const webDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope));
  assert.ok(webDigest instanceof ArrayBuffer);
  assert.equal(uniformFromDigest(webDigest), uniformFromDigest(nodeDigest));
  assert.equal(uniformFromDigest(webDigest), await deterministicRandom("seed", 3, "system", "entity", 0));
});
