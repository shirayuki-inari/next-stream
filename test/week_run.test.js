import test from "node:test";
import assert from "node:assert/strict";
import { commandEnvelope, executeCommand } from "../src/application/commands.js";
import { createGame, migrateGame } from "../src/domain/engine.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game() {
  return migrateGame(createGame({ mode: "direct", routeId: "indie", performerCode: "RUN", characterName: "运行测试", primaryLanguage: "jp", primaryDirection: "game", careerGoal: "creator", seed: "week-run", abilities }));
}

test("START_WEEK stages a complete result without changing official metrics", async () => {
  let state = game();
  state = (await executeCommand(state, commandEnvelope(state, "UPDATE_PLAN", { slotIndex: 0, actionId: "LIVE_GAME" }, "plan-live"))).state;
  const beforeVersion = state.snapshotVersion;
  const started = await executeCommand(state, commandEnvelope(state, "START_WEEK", { planRevision: beforeVersion }, "start-week"));
  assert.equal(started.ok, true);
  assert.equal(started.state.phase, "READY_TO_COMMIT");
  assert.equal(started.state.channel.subscribers, 0);
  assert.equal(started.state.history.weeklyReports.length, 0);
  assert.ok(started.state.weekRun.stagedState.channel.subscribers > 0);
  assert.equal(started.state.weekRun.stagedState.history.weeklyReports.length, 1);
  assert.equal(started.state.weekRun.planHash.length, 64);
});

test("COMMIT_WEEK atomically promotes staged state and cannot be applied twice", async () => {
  let state = game();
  state = (await executeCommand(state, commandEnvelope(state, "UPDATE_PLAN", { slotIndex: 0, actionId: "LIVE_GAME" }, "plan"))).state;
  state = (await executeCommand(state, commandEnvelope(state, "START_WEEK", {}, "start"))).state;
  const envelope = commandEnvelope(state, "COMMIT_WEEK", { runId: state.weekRun.id, runRevision: state.weekRun.runRevision }, "commit");
  const committed = await executeCommand(state, envelope);
  assert.equal(committed.ok, true);
  assert.equal(committed.state.phase, "REPORT");
  assert.ok(committed.state.channel.subscribers > 0);
  assert.equal(committed.state.history.weeklyReports.length, 1);
  assert.equal(committed.state.weekRun.status, "COMMITTED");
  assert.equal("stagedState" in committed.state.weekRun, false);
  const retry = await executeCommand(committed.state, envelope);
  assert.equal(retry.ok, true);
  assert.equal(retry.replayed, true);
  assert.equal(retry.state.history.weeklyReports.length, 1);
});

test("a READY_TO_COMMIT checkpoint survives cloning and can be resumed", async () => {
  let state = game();
  state = (await executeCommand(state, commandEnvelope(state, "START_WEEK", {}, "start-empty"))).state;
  const restored = JSON.parse(JSON.stringify(state));
  const continued = await executeCommand(restored, commandEnvelope(restored, "CONTINUE_WEEK", { runId: restored.weekRun.id }, "continue"));
  assert.equal(continued.ok, true);
  assert.equal(continued.state.phase, "READY_TO_COMMIT");
  const committed = await executeCommand(continued.state, commandEnvelope(continued.state, "COMMIT_WEEK", { runId: continued.state.weekRun.id }, "commit-restored"));
  assert.equal(committed.ok, true);
  assert.equal(committed.state.phase, "REPORT");
});
