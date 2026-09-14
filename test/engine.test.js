import test from "node:test";
import assert from "node:assert/strict";
import {
  averageConcurrent,
  calculateQuality,
  createAudienceSegments,
  createGame,
  settleWeek,
  unionEstimate,
  updatePlan,
} from "../src/domain/engine.js";

const balanced = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function newGame(routeId = "indie", seed = "test-seed") {
  return createGame({
    mode: "direct",
    routeId,
    performerCode: "TEST",
    characterName: "测试信号",
    primaryLanguage: "jp",
    primaryDirection: "game",
    careerGoal: "creator",
    seed,
    abilities: balanced,
  });
}

test("G-09 content quality golden case", () => {
  const result = calculateQuality({ related: 60, preparation: 60, match: 70, production: 50, fatigue: 20, stress: 20, physicalCondition: 90 });
  assert.equal(result.base, 60.5);
  assert.equal(result.stateMultiplier, 1);
  assert.equal(result.quality, 60.5);
});

test("G-10 state multiplier golden case", () => {
  const result = calculateQuality({ related: 60, preparation: 60, match: 70, production: 50, fatigue: 80, stress: 70, physicalCondition: 60 });
  assert.equal(result.stateMultiplier, 0.82);
  assert.equal(Number(result.quality.toFixed(2)), 49.61);
});

test("G-05 average concurrent derives from watch minutes", () => {
  assert.equal(averageConcurrent(800, 18, 120), 120);
});

test("G-11 repeat reach is a union, not a sum", () => {
  assert.equal(unionEstimate(1000, 200, 200), 360);
});

test("audience model creates 24 segments while preserving market total", () => {
  const segments = createAudienceSegments();
  assert.equal(segments.length, 24);
  assert.equal(segments.reduce((sum, segment) => sum + segment.marketPopulation, 0), 2_000_000);
});

test("A-01 all direct debut routes start with zero subscribers and valid asset structure", () => {
  for (const routeId of ["indie", "homolive", "niji2434"]) {
    const state = newGame(routeId, `route-${routeId}`);
    assert.equal(state.channel.subscribers, 0);
    assert.equal(state.character.performerId, state.performer.id);
    assert.equal(state.channel.characterId, state.character.id);
    assert.equal(state.affiliation.agencyId == null, routeId === "indie");
    assert.equal(state.assets.length, 1);
    assert.equal(state.licenses.length, 1);
  }
});

test("A-03 locked life slots prevent a thirteenth work slot", () => {
  let state = newGame();
  for (let index = 0; index < 12; index += 1) {
    if ([5, 9].includes(index)) {
      const result = updatePlan(state, index, "LIVE_GAME", { confirmFlexibleLife: true });
      assert.equal(result.ok, true);
      state = result.state;
    } else {
      const result = updatePlan(state, index, "LIVE_GAME");
      assert.equal(result.ok, true);
      state = result.state;
    }
  }
  const rejected = updatePlan(state, 12, "LIVE_GAME", { confirmFlexibleLife: true });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "INVALID_PLAN");
});

test("A-04 two-slot work occupies adjacent slots on the same day", () => {
  const result = updatePlan(newGame(), 2, "PART_TIME");
  assert.equal(result.ok, true);
  assert.equal(result.state.plan[2].actionId, "PART_TIME");
  assert.equal(result.state.plan[3].actionId, "PART_TIME");
  assert.equal(result.state.plan[2].pairId, result.state.plan[3].pairId);
});

test("A-05 an empty week becomes rest and has no concurrent-viewer zero", async () => {
  const result = await settleWeek(newGame("indie", "empty-week"));
  assert.equal(result.ok, true);
  assert.equal(result.state.metrics.weeklyAverageConcurrent, null);
  assert.equal(result.state.cash.free, "582000");
  assert.equal(result.state.history.contents.length, 0);
});

test("E-06 same seed and plan replay to the same domain result", async () => {
  let first = newGame("homolive", "replay-stable-seed");
  let second = newGame("homolive", "replay-stable-seed");
  for (const [slot, action] of [[0, "PREPARE_CONTENT"], [1, "LIVE_GAME"], [2, "MAKE_SHORT"], [3, "LIVE_CHAT"]]) {
    first = updatePlan(first, slot, action).state;
    second = updatePlan(second, slot, action).state;
  }
  const a = (await settleWeek(first)).state;
  const b = (await settleWeek(second)).state;
  assert.deepEqual(a.metrics, b.metrics);
  assert.deepEqual(a.history.contents, b.history.contents);
  assert.deepEqual(a.audienceSegments, b.audienceSegments);
});

test("journal entries remain balanced in integer yen", async () => {
  let state = newGame("indie", "balanced-ledger");
  state = updatePlan(state, 0, "PART_TIME").state;
  const result = await settleWeek(state);
  assert.equal(result.ok, true);
  for (const entry of result.state.history.journalEntries) {
    const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n);
    const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n);
    assert.equal(debit, credit, entry.id);
  }
});
