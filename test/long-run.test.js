import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../src/domain/engine.js";
import {
  applyTransferPreparation,
  beginTransferExitNegotiation,
  closeTransfer,
  confirmTransferPlan,
  createTransferCase,
  processTransferNotice,
  startTransferNotice,
  switchAffiliation,
} from "../src/domain/transfers.js";
import { runTrajectory } from "../scripts/simulation.mjs";

const balanced = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function unwrap(result) {
  assert.equal(result.ok, true, `${result.code || "UNKNOWN"}: ${result.message || ""}`);
  return result.state;
}

function grantAudition(state, agencyId, suffix) {
  state.auditionApplications.push({ id: `loop_audition_${suffix}`, agencyId, status: "COMPLETED", transferEligibility: { agencyId, granted: true } });
}

function completeTransfer(sourceState, { targetRouteId, plan, date, readyDate, auditionAgencyId = null }) {
  let state = sourceState;
  if (auditionAgencyId) grantAudition(state, auditionAgencyId, `${state.transferCases.length}_${auditionAgencyId}`);
  state = unwrap(createTransferCase(state, { targetRouteId, date }));
  const transferId = state.transferCases.at(-1).id;
  if (state.transferCases.at(-1).status === "DESTINATION_CONFIRMED") state = unwrap(beginTransferExitNegotiation(state, { transferId, date }));
  state = unwrap(confirmTransferPlan(state, { transferId, assetPlanType: plan, date }));
  if (plan === "NEW_IDENTITY") {
    applyTransferPreparation(state, transferId, date);
    applyTransferPreparation(state, transferId, date);
  }
  state = unwrap(startTransferNotice(state, { transferId, date: readyDate }));
  if (state.transferCases.at(-1).status === "NOTICE_PERIOD") {
    state = unwrap(processTransferNotice(state, { transferId, date: state.transferCases.at(-1).noticeEndsAt }));
  }
  state = unwrap(switchAffiliation(state, { transferId, date: state.transferCases.at(-1).noticeEndsAt || readyDate }));
  return unwrap(closeTransfer(state, { transferId, date: state.transferCases.at(-1).switchedAt }));
}

test("E-13 a real 104-week trajectory keeps references, IDs, inventory, and budgets valid", { timeout: 30_000 }, async () => {
  const result = await runTrajectory({ routeId: "indie", strategyId: "conservative", seed: "e13-104-week", validateEveryWeek: true });
  assert.equal(result.finalPhase, "RETROSPECTIVE");
  assert.equal(result.checkpoints[104].projectDefaults, 0);
  assert.ok(result.saveBytes <= 25 * 1024 * 1024);
});

test("frequent transfer cycles cannot mint free cash or duplicate a main affiliation", () => {
  let state = createGame({ mode: "direct", routeId: "indie", performerCode: "LOOP", characterName: "循环测试", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed: "transfer-no-profit", abilities: balanced });
  const openingCash = BigInt(state.cash.free);
  state = completeTransfer(state, { targetRouteId: "homolive", plan: "KEEP_ALL", date: "2026-09-14", readyDate: "2026-09-14", auditionAgencyId: "agency_homolive" });
  state = completeTransfer(state, { targetRouteId: "niji2434", plan: "NEW_IDENTITY", date: "2026-09-21", readyDate: "2026-10-05", auditionAgencyId: "agency_2434" });
  state = completeTransfer(state, { targetRouteId: "indie", plan: "NEW_IDENTITY", date: "2026-11-09", readyDate: "2026-11-23" });
  assert.ok(BigInt(state.cash.free) <= openingCash);
  assert.equal([state.affiliation, ...state.affiliationHistory].filter((item) => !item.effectiveTo).length, 1);
  assert.equal(state.transferCases.every((item) => item.status === "CLOSED"), true);
});
