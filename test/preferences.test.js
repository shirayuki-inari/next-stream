import test from "node:test";
import assert from "node:assert/strict";
import { createGame, settleWeek, updatePlan } from "../src/domain/engine.js";
import { updatePreferences } from "../src/domain/preferences.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };
function game(seed = "preferences") {
  const state = createGame({ mode: "direct", routeId: "homolive", performerCode: "PREF", characterName: "显示测试", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed, abilities });
  state.textEvents = [];
  state.eventWeeksProcessed.push(1);
  return state;
}

function withoutPresentation(state) {
  const copy = structuredClone(state);
  delete copy.preferences;
  copy.snapshotVersion = 0;
  return copy;
}

test("E-15 switching every brand label to the original pack leaves simulation results unchanged", async () => {
  const base = updatePlan(game("name-pack"), 0, "LIVE_GAME").state;
  const changed = updatePreferences(base, { reduceMotion: true, namePackId: "original_release" });
  assert.equal(changed.ok, true);
  const referenceResult = await settleWeek(base);
  const originalResult = await settleWeek(changed.state);
  assert.deepEqual(withoutPresentation(originalResult.state), withoutPresentation(referenceResult.state));
});
