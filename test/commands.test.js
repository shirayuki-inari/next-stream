import test from "node:test";
import assert from "node:assert/strict";
import { commandEnvelope, executeCommand } from "../src/application/commands.js";
import { createGame, migrateGame } from "../src/domain/engine.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game() {
  return migrateGame(createGame({ mode: "direct", routeId: "indie", performerCode: "CMD", characterName: "命令测试", primaryLanguage: "jp", primaryDirection: "game", careerGoal: "creator", seed: "commands", abilities }));
}

test("E-01 retrying the same command returns its first result without a second effect", async () => {
  const initial = game();
  const envelope = commandEnvelope(initial, "UPDATE_PLAN", { slotIndex: 0, actionId: "LIVE_GAME", confirmFlexibleLife: false }, "same-command");
  const first = await executeCommand(initial, envelope);
  assert.equal(first.ok, true);
  assert.equal(first.replayed, false);
  const version = first.state.snapshotVersion;
  const retry = await executeCommand(first.state, envelope);
  assert.equal(retry.ok, true);
  assert.equal(retry.replayed, true);
  assert.equal(retry.state.snapshotVersion, version);
  assert.equal(retry.state.commandRecords.length, 1);
});

test("same command ID with a different payload is rejected", async () => {
  const initial = game();
  const first = await executeCommand(initial, commandEnvelope(initial, "UPDATE_PLAN", { slotIndex: 0, actionId: "LIVE_GAME" }, "reused"));
  const second = await executeCommand(first.state, { ...commandEnvelope(first.state, "UPDATE_PLAN", { slotIndex: 1, actionId: "LIVE_CHAT" }, "reused") });
  assert.equal(second.ok, false);
  assert.equal(second.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(second.stateChanged, false);
});

test("E-02 stale snapshot version cannot overwrite a newer plan", async () => {
  const initial = game();
  const first = await executeCommand(initial, commandEnvelope(initial, "UPDATE_PLAN", { slotIndex: 0, actionId: "LIVE_GAME" }, "first"));
  const stale = await executeCommand(first.state, { command_id: "stale", game_id: initial.id, expected_snapshot_version: initial.snapshotVersion, type: "UPDATE_PLAN", payload: { slotIndex: 1, actionId: "LIVE_CHAT" } });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "STALE_STATE");
  assert.equal(first.state.plan[1].actionId, null);
});

test("PREVIEW_WEEK remains read-only and does not advance snapshot version", async () => {
  const initial = game();
  const preview = await executeCommand(initial, commandEnvelope(initial, "PREVIEW_WEEK", {}, "preview"));
  assert.equal(preview.ok, true);
  assert.equal(preview.state.snapshotVersion, initial.snapshotVersion);
  assert.equal(preview.state.commandRecords.length, 0);
});
