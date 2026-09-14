import test from "node:test";
import assert from "node:assert/strict";
import { createGame, settleWeek, updatePlan } from "../src/domain/engine.js";
import { collaborationExposureCoefficient, ensureWorldWeek, invitationScore, respondToNpcInvitation, submitCollaborationInvitation } from "../src/domain/world.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game(seed = "world-test") {
  return createGame({ mode: "direct", routeId: "indie", performerCode: "WORLD", characterName: "世界测试", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed, abilities });
}

test("fixed seed creates the exact 20 major NPCs with complete persistent fields and varied route sizes", () => {
  const state = game();
  assert.equal(state.npcs.length, 20);
  assert.deepEqual(state.npcs.map((npc) => npc.name), ["暮铃", "晴芽", "雾帆", "星檐", "绒羽", "夏玻", "白岚", "镜川", "绘砂", "夜瓷", "灯浦", "锦弦", "鲸灯", "松墨", "灰糖", "雨匣", "碎月", "苔羽", "岩星", "蓝隙"]);
  for (const npc of state.npcs) {
    assert.ok(npc.affiliationId && npc.language && npc.direction && npc.careerGoal && npc.currentProject);
    assert.equal(Object.keys(npc.abilities).length, 6);
    assert.equal(npc.availableSlots.length, 4);
    assert.equal(typeof npc.channelSize, "number");
    assert.equal(typeof npc.healthLoad, "number");
    const relation = state.relationships.find((item) => item.subjectB === npc.id);
    assert.ok(relation);
    assert.ok([relation.familiarity, relation.workTrust, relation.contentSynergy].every((value) => value >= 0 && value <= 100));
  }
  for (const affiliationId of ["homolive", "2434", "indie"]) {
    assert.deepEqual(new Set(state.npcs.filter((npc) => npc.affiliationId === affiliationId).map((npc) => npc.sizeTier)), new Set(["NEWCOMER", "GROWING", "MATURE"]));
  }
  assert.deepEqual(game().npcs, state.npcs);
});

test("invitation formula uses four explicit dimensions and never hard-blocks subscriber difference", () => {
  const state = game("score-test");
  const npc = state.npcs.find((item) => item.sizeTier === "MATURE");
  npc.channelSize = 5_000_000;
  state.channel.subscribers = 0;
  const relation = state.relationships.find((item) => item.subjectB === npc.id);
  Object.assign(relation, { contentSynergy: 90, workTrust: 90 });
  npc.currentProject.projectValue = 90;
  const score = invitationScore(state, npc.id);
  assert.equal(score.total, Math.round((.35 * score.contentFit + .25 * score.workTrust + .20 * score.mutualProjectValue + .20 * score.preparation) * 100) / 100);
  assert.ok(score.total >= 55);
  assert.equal(score.formulaVersion, "COLLAB_INVITATION_1_0");
});

test("accepted invitation creates one reservation and a repeated same-slot invitation returns SLOT_CONFLICT", () => {
  const state = game("conflict-test");
  const npc = state.npcs[0];
  const slotIndex = npc.availableSlots[0];
  const relation = state.relationships.find((item) => item.subjectB === npc.id);
  Object.assign(relation, { contentSynergy: 100, workTrust: 100 });
  npc.currentProject.projectValue = 100;
  const first = submitCollaborationInvitation(state, { npcId: npc.id, slotIndex });
  assert.equal(first.ok, true);
  assert.equal(first.invitation.status, "ACCEPTED");
  assert.equal(first.state.collaborationReservations.length, 1);
  const second = submitCollaborationInvitation(first.state, { npcId: npc.id, slotIndex });
  assert.equal(second.ok, false);
  assert.equal(second.code, "SLOT_CONFLICT");
});

test("world-week schedules are deterministic and retained instead of rerolled", () => {
  const state = game("persistent-world");
  const original = structuredClone(state.worldWeeks[0]);
  ensureWorldWeek(state, 1);
  ensureWorldWeek(state, 1);
  assert.equal(state.worldWeeks.length, 1);
  assert.deepEqual(state.worldWeeks[0], original);
  const other = game("persistent-world");
  assert.deepEqual(other.worldWeeks[0], original);
});

test("world events have explicit dates and non-stacking decay while NPCs autonomously update and invite", () => {
  const state = game("autonomous-world");
  let invitation = null;
  for (let weekIndex = 2; weekIndex <= 16; weekIndex += 1) {
    state.weekIndex = weekIndex;
    const worldWeek = ensureWorldWeek(state, weekIndex);
    for (const event of worldWeek.worldEvents) {
      assert.ok(event.startDate <= event.endDate);
      assert.ok(event.heat > 0 && event.heat <= 100);
      assert.ok(["ACTIVE", "COOLING"].includes(event.phase));
    }
    invitation ||= state.npcInvitations.find((item) => item.weekIndex === weekIndex && item.status === "OPEN");
  }
  assert.equal(new Set(state.worldWeeks.map((item) => item.weekIndex)).size, state.worldWeeks.length);
  assert.ok(state.worldWeeks.some((item) => item.npcUpdates.length));
  assert.ok(invitation);
  state.weekIndex = invitation.weekIndex;
  const accepted = respondToNpcInvitation(state, { invitationId: invitation.id, accept: true });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.reservation.initiatedBy, "NPC");
});

test("a confirmed collaboration must occupy its reserved slot and only exposure decays across four weeks", async () => {
  let state = game("collab-settlement");
  const npc = state.npcs[0];
  const slotIndex = npc.availableSlots[0];
  const relation = state.relationships.find((item) => item.subjectB === npc.id);
  Object.assign(relation, { contentSynergy: 100, workTrust: 100 });
  npc.currentProject.projectValue = 100;
  const invited = submitCollaborationInvitation(state, { npcId: npc.id, slotIndex });
  assert.equal(invited.ok, true);
  state = invited.state;
  const wrongSlot = (slotIndex + 1) % 14;
  const wrong = updatePlan(state, wrongSlot, "LIVE_COLLAB", { targetId: invited.reservation.id, targetType: "COLLAB_RESERVATION" });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, "REQUIREMENT_UNMET");
  const planned = updatePlan(state, slotIndex, "LIVE_COLLAB", { targetId: invited.reservation.id, targetType: "COLLAB_RESERVATION", confirmFlexibleLife: true });
  assert.equal(planned.ok, true);
  const familiarityBefore = relation.familiarity;
  const settled = await settleWeek(planned.state);
  assert.equal(settled.ok, true);
  const content = settled.report.contents.find((item) => item.actionId === "LIVE_COLLAB");
  assert.equal(content.collaboration.exposureCoefficient, 1);
  const updated = settled.state.relationships.find((item) => item.subjectB === npc.id);
  assert.equal(updated.familiarity, familiarityBefore + 4);
  settled.state.collaborationHistory.push(
    { npcId: npc.id, date: "2026-09-15" },
    { npcId: npc.id, date: "2026-09-16" },
  );
  assert.equal(collaborationExposureCoefficient(settled.state, npc.id, "2026-09-20"), 0.2);
});
