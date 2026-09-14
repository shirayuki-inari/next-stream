import test from "node:test";
import assert from "node:assert/strict";
import { createGame, settleWeek, updatePlan } from "../src/domain/engine.js";
import { recordPlatformRevenue } from "../src/domain/finance.js";
import {
  applyTransferPreparation,
  beginTransferExitNegotiation,
  confirmTransferPlan,
  createTransferCase,
  processTransferNotice,
  startTransferNotice,
  switchAffiliation,
} from "../src/domain/transfers.js";

const balanced = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game(seed, routeId = "indie") {
  return createGame({ mode: "direct", routeId, performerCode: "TRANSFER", characterName: "转籍测试", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed, abilities: balanced });
}

function unwrap(result) {
  assert.equal(result.ok, true, result.message);
  return result.state;
}

function grantCompletedAudition(state, agencyId) {
  state.auditionApplications.push({ id: `completed_${agencyId}`, agencyId, status: "COMPLETED", transferEligibility: { agencyId, granted: true } });
}

test("A-31/A-34 personal creator joins with player-owned character, separate agency license, and retained channel", () => {
  let state = game("transfer-keep-all");
  state.channel.subscribers = 1200;
  state.channel.fanFundingStatus = "APPROVED";
  state.channel.scFeatureEnabled = true;
  grantCompletedAudition(state, "agency_homolive");
  state = unwrap(createTransferCase(state, { targetRouteId: "homolive", date: "2026-09-14" }));
  const transferId = state.transferCases[0].id;
  state = unwrap(beginTransferExitNegotiation(state, { transferId, date: "2026-09-14" }));
  state = unwrap(confirmTransferPlan(state, { transferId, assetPlanType: "KEEP_ALL", date: "2026-09-14" }));
  state = unwrap(startTransferNotice(state, { transferId, date: "2026-09-14" }));
  assert.equal(state.transferCases[0].status, "READY_TO_SWITCH");
  const oldChannelId = state.channel.id;
  const assetId = state.character.assetIds[0];
  state = unwrap(switchAffiliation(state, { transferId, date: "2026-09-14" }));
  assert.equal(state.routeId, "homolive");
  assert.equal(state.assets.find((item) => item.id === assetId).ownerParty, "PLAYER");
  assert.equal(state.licenses.some((item) => item.assetId === assetId && item.licenseeParty === "agency_homolive"), true);
  assert.equal(state.channel.id, oldChannelId);
  assert.equal(state.channel.subscribers, 1200);
  assert.equal(state.channel.scFeatureEnabled, true);
});

test("A-32/A-33 corporate exit without surviving character or channel rights requires a new identity and zero-subscriber channel", () => {
  let state = game("transfer-new-identity", "homolive");
  state.channel.subscribers = 200000;
  state.metrics.active28dEstimate = 20000;
  state = unwrap(createTransferCase(state, { targetRouteId: "indie", date: "2026-09-14" }));
  const transferId = state.transferCases[0].id;
  const denied = confirmTransferPlan(state, { transferId, assetPlanType: "KEEP_CHARACTER_NEW_CHANNEL", date: "2026-09-14" });
  assert.equal(denied.code, "ASSET_LICENSE_REQUIRED");
  state = unwrap(confirmTransferPlan(state, { transferId, assetPlanType: "NEW_IDENTITY", date: "2026-09-14" }));
  applyTransferPreparation(state, transferId, "2026-09-15");
  applyTransferPreparation(state, transferId, "2026-09-16");
  state = unwrap(startTransferNotice(state, { transferId, date: "2026-09-28" }));
  state = unwrap(processTransferNotice(state, { transferId, date: "2026-10-26" }));
  const oldChannelId = state.channel.id;
  state = unwrap(switchAffiliation(state, { transferId, date: "2026-10-26" }));
  assert.equal(state.routeId, "indie");
  assert.equal(state.channel.subscribers, 0);
  assert.notEqual(state.channel.id, oldChannelId);
  assert.equal(state.historicalChannels[0].archivedSubscribers, 200000);
  assert.equal(state.transferCases[0].audienceMigration.stableViewerEstimate, 6240);
  assert.deepEqual(state.transferCases[0].audienceMigration.contactSchedule, [0.4, 0.3, 0.2, 0.1]);
});

test("A-35/A-36 same-day revenue keeps its occurrence contract and cross-company switch is atomic", () => {
  let state = game("transfer-cross-company", "homolive");
  const oldContractId = state.contract.id;
  grantCompletedAudition(state, "agency_2434");
  recordPlatformRevenue(state, { id: "old_income", sourceId: "old", type: "SC", grossJpy: "1000", date: "2026-09-14" });
  state = unwrap(createTransferCase(state, { targetRouteId: "niji2434", date: "2026-09-14" }));
  const transferId = state.transferCases[0].id;
  state = unwrap(beginTransferExitNegotiation(state, { transferId, date: "2026-09-14" }));
  state = unwrap(confirmTransferPlan(state, { transferId, assetPlanType: "NEW_IDENTITY", date: "2026-09-14" }));
  applyTransferPreparation(state, transferId, "2026-09-15");
  applyTransferPreparation(state, transferId, "2026-09-16");
  state = unwrap(startTransferNotice(state, { transferId, date: "2026-09-28" }));
  state = unwrap(processTransferNotice(state, { transferId, date: "2026-10-26" }));
  state = unwrap(switchAffiliation(state, { transferId, date: "2026-10-26" }));
  recordPlatformRevenue(state, { id: "new_income", sourceId: "new", type: "SC", grossJpy: "1000", date: "2026-10-26" });
  assert.equal(state.history.receivables.find((item) => item.originalTransactionId === "old_income").contractId, oldContractId);
  assert.equal(state.history.receivables.find((item) => item.originalTransactionId === "new_income").contractId, state.contract.id);
  assert.notEqual(state.contract.id, oldContractId);
  assert.equal(state.affiliationHistory[0].effectiveTo, "2026-10-26");
  assert.equal([state.affiliation, ...state.affiliationHistory].filter((item) => !item.effectiveTo).length, 1);
  assert.equal(state.transferCases[0].noDualAffiliation, true);
});

test("A-37/A-38/A-39 low cash can enter exit handling, and graduation preserves trust plus order responsibility", () => {
  let lowCash = game("transfer-low-cash", "homolive");
  lowCash.cash.free = "0";
  lowCash = unwrap(createTransferCase(lowCash, { targetRouteId: "indie", date: "2026-09-14" }));
  const lowId = lowCash.transferCases[0].id;
  const paused = confirmTransferPlan(lowCash, { transferId: lowId, assetPlanType: "NEW_IDENTITY", date: "2026-09-14" });
  assert.equal(paused.ok, true);
  assert.equal(paused.state.transferCases[0].status, "PAUSED");
  assert.equal(paused.state.cash.free, "0");

  let state = game("transfer-obligations", "homolive");
  state.relationships = [{ subjectA: state.performer.id, subjectB: "manager", familiarity: 60, workTrust: 72, contentSynergy: 40 }];
  state.projects.push({ id: "open_merch", type: "MERCH", title: "未发货商品", orderCount: 30, deliveredOrders: 10, fulfillmentParty: "agency_homolive", status: "PRODUCING" });
  const reputation = state.performer.workReputation;
  state = unwrap(createTransferCase(state, { targetRouteId: "indie", date: "2026-09-14" }));
  const transferId = state.transferCases[0].id;
  assert.equal(state.transferCases[0].exitChecklist.obligations[0].type, "UNDELIVERED_MERCH");
  state = unwrap(confirmTransferPlan(state, { transferId, assetPlanType: "NEW_IDENTITY", date: "2026-09-14" }));
  assert.equal(state.transferCases[0].exitChecklist.obligations[0].treatment, "PRESERVE_EXISTING_RESPONSIBILITY");
  applyTransferPreparation(state, transferId, "2026-09-15");
  applyTransferPreparation(state, transferId, "2026-09-16");
  state = unwrap(startTransferNotice(state, { transferId, date: "2026-09-28" }));
  state = unwrap(processTransferNotice(state, { transferId, date: "2026-10-26" }));
  state = unwrap(switchAffiliation(state, { transferId, date: "2026-10-26" }));
  assert.equal(state.projects.find((item) => item.id === "open_merch").fulfillmentParty, "agency_homolive");
  assert.equal(state.projects.find((item) => item.id === "open_merch").status, "PRODUCING");
  assert.equal(state.performer.workReputation, reputation);
  assert.equal(state.relationships[0].workTrust, 72);
});

test("new identity work is bound to exactly two real weekly plan slots", async () => {
  let state = game("transfer-scheduled-prep", "homolive");
  state = unwrap(createTransferCase(state, { targetRouteId: "indie", date: "2026-09-14" }));
  const transferId = state.transferCases[0].id;
  state = unwrap(confirmTransferPlan(state, { transferId, assetPlanType: "NEW_IDENTITY", date: "2026-09-14" }));
  state = unwrap(updatePlan(state, 0, "TRANSFER_PREP", { targetId: transferId, targetType: "TRANSFER_CASE" }));
  state = unwrap(updatePlan(state, 1, "TRANSFER_PREP", { targetId: transferId, targetType: "TRANSFER_CASE" }));
  assert.equal(updatePlan(state, 2, "TRANSFER_PREP", { targetId: transferId, targetType: "TRANSFER_CASE" }).code, "INVALID_PLAN");
  const settled = await settleWeek(state);
  assert.equal(settled.ok, true);
  assert.equal(settled.state.transferCases[0].identityPreparation.completedUnits, 2);
});
