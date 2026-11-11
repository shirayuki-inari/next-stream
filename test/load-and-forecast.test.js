import test from "node:test";
import assert from "node:assert/strict";
import { acknowledgeReport, createGame, dailyRecovery, forecastPlan, overloadRisk, settleWeek, slotLoad, updatePlan, weeklyExpenses } from "../src/domain/engine.js";
import { BALANCE_PROFILES } from "../rules/balance_profiles.js";
import { BALANCE as BALANCE_0_2 } from "../rules/balance_standard_0_2.js";

const balanced = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };
const ORDINARY_SLOTS = [0, 1, 2, 3, 4, 6, 7, 8, 10, 11];

function newGame(seed = "load-seed", extra = {}) {
  return createGame({ mode: "direct", routeId: "indie", performerCode: "LOAD", characterName: "负荷测试", primaryLanguage: "jp", primaryDirection: "game", careerGoal: "creator", seed, abilities: balanced, ...extra });
}

function plan(state, actions) {
  let current = state;
  actions.forEach((actionId, index) => {
    const result = updatePlan(current, ORDINARY_SLOTS[index], actionId);
    assert.equal(result.ok, true, `${actionId} @ ${ORDINARY_SLOTS[index]}`);
    current = result.state;
  });
  return current;
}

async function runWeeks(state, actions, weeks) {
  let current = state;
  for (let week = 0; week < weeks; week += 1) {
    current = plan(current, actions);
    const settled = await settleWeek(current);
    assert.equal(settled.ok, true);
    current = acknowledgeReport(settled.state).state;
  }
  return current;
}

test("new games bind balance_standard_0_2 while an explicit legacy id keeps 0_1", () => {
  const fresh = newGame();
  assert.equal(fresh.rulesets.balance, "balance_standard_0_2");
  assert.equal(fresh.cash.free, BALANCE_0_2.initialState.cashFreeJpy);
  const legacy = newGame("legacy", { balanceRulesetId: "balance_standard_0_1" });
  assert.equal(legacy.rulesets.balance, "balance_standard_0_1");
  assert.equal(legacy.cash.free, "600000");
});

test("0_2 recovery is proportional to the current level, while 0_1 stays flat", () => {
  const current = BALANCE_PROFILES.balance_standard_0_2;
  const legacy = BALANCE_PROFILES.balance_standard_0_1;
  assert.ok(dailyRecovery(current, { fatigue: 80, stress: 20 }).fatigue > dailyRecovery(current, { fatigue: 10, stress: 20 }).fatigue);
  assert.ok(-slotLoad(current, "REST", { fatigue: 80, stress: 20 }).fatigue > -slotLoad(current, "REST", { fatigue: 10, stress: 20 }).fatigue);
  assert.deepEqual(dailyRecovery(legacy, { fatigue: 80, stress: 20 }), { fatigue: 4, stress: 2 });
  assert.equal(slotLoad(legacy, "REST", { fatigue: 80, stress: 20 }).fatigue, -10);
});

test("heavier weekly workloads settle at higher interior fatigue instead of only zero or the cap", async () => {
  const light = await runWeeks(newGame("light"), ["PREPARE_CONTENT", "LIVE_GAME", "REVIEW", "PRACTICE", "LIVE_CHAT", "EDIT_VIDEO", "NETWORK"], 8);
  const medium = await runWeeks(newGame("medium"), ["PREPARE_CONTENT", "LIVE_GAME", "REVIEW", "PRACTICE", "LIVE_CHAT", "EDIT_VIDEO", "NETWORK", "LIVE_GAME", "MAKE_SHORT"], 8);
  assert.ok(light.performer.fatigue < medium.performer.fatigue, `${light.performer.fatigue} < ${medium.performer.fatigue}`);
  assert.ok(medium.performer.fatigue > 15 && medium.performer.fatigue < 70, `medium settles in the interior: ${medium.performer.fatigue}`);
});

test("overload risk only applies above the threshold and never to committed slots", () => {
  const profile = BALANCE_PROFILES.balance_standard_0_2;
  const threshold = profile.overload.fatigueThreshold;
  assert.equal(overloadRisk(profile, threshold - 1, "LIVE_GAME"), 0);
  assert.equal(overloadRisk(profile, threshold, "LIVE_GAME"), profile.overload.baseRisk);
  assert.equal(overloadRisk(profile, 100, "LIVE_GAME"), profile.overload.maximumRisk);
  assert.equal(overloadRisk(profile, 90, "LIVE_COLLAB", { targetId: "collab_x" }), 0);
  assert.equal(overloadRisk(profile, 90, "PART_TIME"), 0);
  assert.equal(overloadRisk(BALANCE_PROFILES.balance_standard_0_1, 95, "LIVE_GAME"), 0);
});

test("an overloaded week can cancel uncommitted content deterministically and reports it", async () => {
  let cancelledWeeks = 0;
  for (const seed of ["overload-a", "overload-b", "overload-c", "overload-d"]) {
    const state = newGame(seed);
    state.performer.fatigue = 95;
    const planned = plan(state, ["LIVE_GAME", "LIVE_CHAT", "MAKE_SHORT", "LIVE_GAME", "EDIT_VIDEO", "LIVE_CHAT", "MAKE_SHORT", "LIVE_GAME", "LIVE_CHAT", "MAKE_SHORT"]);
    const first = await settleWeek(planned);
    const second = await settleWeek(planned);
    assert.deepEqual(first.report.cancelledSlots, second.report.cancelledSlots);
    const cancelled = first.report.activities.filter((item) => item.cancelled);
    assert.equal(cancelled.length, first.report.cancelledSlots?.length || 0);
    assert.equal(first.report.contents.length + cancelled.length, 10);
    if (cancelled.length) cancelledWeeks += 1;
  }
  assert.ok(cancelledWeeks > 0, "at fatigue 95 at least one of four seeds cancels a slot");
});

test("the per-slot forecast brackets settled subscribers and matches settled fatigue", async () => {
  for (const seed of ["forecast-a", "forecast-b", "forecast-c"]) {
    let state = await runWeeks(newGame(seed), ["PREPARE_CONTENT", "LIVE_GAME", "REVIEW", "LIVE_CHAT", "EDIT_VIDEO", "MAKE_SHORT"], 3);
    state = plan(state, ["PREPARE_CONTENT", "LIVE_GAME", "LIVE_CHAT", "MAKE_SHORT", "LIVE_MUSIC", "EDIT_VIDEO"]);
    const forecast = forecastPlan(state);
    const settled = await settleWeek(state);
    assert.equal(settled.ok, true);
    assert.ok(!settled.report.cancelledSlots);
    const [low, high] = forecast.subscriberRange;
    assert.ok(settled.report.subscriberDelta >= low && settled.report.subscriberDelta <= high, `${seed}: ${low} ≤ ${settled.report.subscriberDelta} ≤ ${high}`);
    for (const content of settled.report.contents) {
      const slot = forecast.slots.find((item) => item.quality && content.id.endsWith(`_s${item.slotIndex}`));
      assert.ok(content.quality >= slot.quality[0] - 0.05 && content.quality <= slot.quality[1] + 0.05, `${content.id} quality ${content.quality} in ${slot.quality}`);
    }
    assert.equal(settled.state.performer.fatigue, forecast.projectedFatigue);
  }
});

test("channel operating costs scale with subscribers and are lighter for company routes", () => {
  const indie = newGame("costs");
  assert.equal(weeklyExpenses(indie).operations, 0n);
  indie.channel.subscribers = 40_000;
  assert.equal(weeklyExpenses(indie).operations, 60_000n);
  indie.channel.subscribers = 5_000_000;
  assert.equal(weeklyExpenses(indie).operations, BigInt(BALANCE_0_2.costs.channelOperations.weeklyCapJpy));
  const company = createGame({ mode: "direct", routeId: "homolive", performerCode: "LOAD", characterName: "负荷测试", primaryLanguage: "jp", primaryDirection: "game", careerGoal: "creator", seed: "costs", abilities: balanced });
  company.channel.subscribers = 40_000;
  assert.equal(weeklyExpenses(company).operations, 20_000n);
  const legacy = newGame("costs-legacy", { balanceRulesetId: "balance_standard_0_1" });
  legacy.channel.subscribers = 40_000;
  assert.equal(weeklyExpenses(legacy).operations, 0n);
});

test("a cash shortfall is absorbed by the performer's state and reported", async () => {
  const state = newGame("shortfall");
  state.cash.free = "5000";
  state.history.journalEntries[0].lines = [{ account: "CASH_FREE", debit: "5000", credit: "0" }, { account: "OPENING_EQUITY", debit: "0", credit: "5000" }];
  const funded = await settleWeek(newGame("shortfall"));
  const settled = await settleWeek(state);
  assert.equal(settled.ok, true);
  assert.equal(settled.state.cash.free, "0");
  assert.equal(settled.report.cashShortfallJpy, String(18_000 - 5_000));
  assert.equal(funded.report.cashShortfallJpy, undefined);
  assert.equal(settled.state.performer.stress - funded.state.performer.stress, BALANCE_0_2.cashShortfall.stress);
  assert.equal(settled.state.performer.motivation - funded.state.performer.motivation, BALANCE_0_2.cashShortfall.motivation);
});
