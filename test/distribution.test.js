import test from "node:test";
import assert from "node:assert/strict";
import { createGame, settleWeek, updatePlan } from "../src/domain/engine.js";
import { createPropagationCommission } from "../src/domain/distribution.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };
function game(seed = "distribution") {
  return createGame({ mode: "direct", routeId: "indie", performerCode: "DIST", characterName: "传播测试", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed, abilities });
}

async function withPublishedContent(seed) {
  let state = game(seed);
  state.textEvents = [];
  state.eventWeeksProcessed.push(1);
  state = updatePlan(state, 0, "MAKE_SHORT").state;
  return (await settleWeek(state)).state;
}

test("paid clipping and translation use separate explicit licenses and never imply arbitrary repost rights", async () => {
  let state = await withPublishedContent("licenses");
  state.phase = "PLANNING";
  const source = state.history.contents[0];
  const before = BigInt(state.cash.free);
  const clip = createPropagationCommission(state, { sourceContentId: source.id, serviceType: "CLIP_EDIT", date: "2026-09-21" });
  assert.equal(clip.ok, true);
  assert.equal(clip.commission.licenseScope, "PUBLIC_EXCERPT_ONLY");
  assert.equal(clip.commission.thirdPartyMaterialPolicy, "NO_UNLICENSED_REUSE");
  const translation = createPropagationCommission(clip.state, { sourceContentId: source.id, serviceType: "SUBTITLE_TRANSLATION", targetLanguage: "en", date: "2026-09-21" });
  assert.equal(translation.ok, true);
  assert.equal(translation.commission.licenseScope, "PLAYER_AUTHORIZED_SUBTITLE_ONLY");
  assert.notEqual(translation.commission.licenseTag, clip.commission.licenseTag);
  assert.equal(BigInt(translation.state.cash.free), before - 15000n - 22000n);
  assert.equal(translation.state.history.contents[0].propagationLicenses.length, 2);
});

test("completed propagation becomes a bounded recommendation input and is consumed once", async () => {
  let state = await withPublishedContent("propagation");
  state.phase = "PLANNING";
  state.weekIndex = 3;
  state.plan = game("fresh-plan").plan;
  const source = state.history.contents[0];
  const commissioned = createPropagationCommission(state, { sourceContentId: source.id, serviceType: "CLIP_EDIT", date: "2026-09-21" });
  state = commissioned.state;
  state.weekIndex = 4;
  state.plan = game("fresh-plan-2").plan;
  state.textEvents = [];
  state.eventWeeksProcessed.push(4);
  state = updatePlan(state, 0, "MAKE_SHORT").state;
  const settled = await settleWeek(state);
  assert.equal(settled.ok, true);
  const content = settled.report.contents[0];
  assert.ok(content.propagationBoost > 0);
  assert.equal(settled.state.propagationEvents[0].status, "APPLIED");
  assert.equal(settled.state.propagationEvents[0].appliedToContentId, content.id);
  assert.equal(settled.state.propagationCommissions[0].status, "APPLIED");
});
