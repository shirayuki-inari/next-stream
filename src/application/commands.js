import { acknowledgeReport, migrateGame, previewWeek, removePlanAction, updatePlan } from "../domain/engine.js";
import { applyForAds, applyForFanFunding, payRefundPayable, setMembershipPolicy } from "../domain/finance.js";
import { commitWeekRun, continueWeekRun, startWeekRun } from "../domain/week_run.js";
import { acceptSponsorship } from "../domain/sponsorship.js";
import {
  beginMerchProduction,
  cancelMerchProject,
  closeMerchSales,
  confirmMerchProject,
  createMerchProject,
  openMerchSales,
  payMerchRefundPayable,
  processMerchProjectDate,
  promoteMerchProject,
  refundDeliveredMerch,
  resolveUnderMoq,
  settleMerchProject,
  startMerchFulfillment,
} from "../domain/merch.js";
import {
  advanceLongProjectTail,
  archiveLongProject,
  approveLongProject,
  cancelLongProject,
  createLongProject,
  enterLongProjectProduction,
  passLongProjectQuality,
  pauseLongProject,
  processLongProjectDate,
  publishLongProject,
  resumeLongProject,
  startLongProject,
  submitLongProject,
} from "../domain/projects.js";
import {
  acceptAuditionContractReview,
  beginAuditionContractReview,
  completeAudition,
  createAuditionApplication,
  requestAuditionOfferExtension,
  resolveAuditionScreening,
  startAuditionScreening,
  submitAuditionApplication,
  withdrawAudition,
} from "../domain/audition.js";
import { requestAgencyResource, resolveAgencyResourceBatch } from "../domain/resources.js";
import { beginTransferExitNegotiation, cancelTransfer, closeTransfer, confirmTransferPlan, createTransferCase, processTransferNotice, resumeTransfer, startTransferNotice, switchAffiliation } from "../domain/transfers.js";
import { respondToNpcInvitation, submitCollaborationInvitation } from "../domain/world.js";
import { resolveTextEvent } from "../domain/events.js";
import { acknowledgeTutorialStep, continueAfterRetrospective, endCareer, skipTutorial } from "../domain/career.js";
import { createPropagationCommission } from "../domain/distribution.js";
import { updatePreferences } from "../domain/preferences.js";
import { changeContentVisibility } from "../domain/content.js";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

async function payloadHash(type, payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize({ type, payload })));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function failure(code, message, details = {}) {
  return { ok: false, code, message, details, stateChanged: false };
}

export async function executeCommand(sourceState, envelope) {
  const state = migrateGame(sourceState);
  if (!state || envelope.game_id !== state.id) return failure("INVALID_SAVE", "命令目标与当前存档不一致");
  if (!envelope.command_id || typeof envelope.command_id !== "string") return failure("INVALID_COMMAND", "命令缺少稳定 ID");
  const hash = await payloadHash(envelope.type, envelope.payload || {});
  const existing = state.commandRecords.find((record) => record.commandId === envelope.command_id);
  if (existing) {
    if (existing.payloadHash !== hash) return failure("IDEMPOTENCY_KEY_REUSED", "同一命令 ID 已用于不同内容");
    return { ...existing.result, state, replayed: true };
  }
  if (envelope.expected_snapshot_version !== state.snapshotVersion) return failure("STALE_STATE", "存档版本已经改变，请刷新后重试", { expected: envelope.expected_snapshot_version, actual: state.snapshotVersion });

  let domainResult;
  switch (envelope.type) {
    case "UPDATE_PLAN":
      domainResult = updatePlan(state, envelope.payload.slotIndex, envelope.payload.actionId, { confirmFlexibleLife: envelope.payload.confirmFlexibleLife === true, targetId: envelope.payload.targetId || null, targetType: envelope.payload.targetType || null });
      break;
    case "REMOVE_PLAN_ACTION":
      domainResult = removePlanAction(state, envelope.payload.slotIndex);
      break;
    case "START_WEEK":
      domainResult = await startWeekRun(state);
      break;
    case "CONTINUE_WEEK":
      domainResult = continueWeekRun(state);
      break;
    case "COMMIT_WEEK":
      domainResult = commitWeekRun(state);
      break;
    case "ACKNOWLEDGE_REPORT":
      domainResult = acknowledgeReport(state);
      break;
    case "APPLY_FAN_FUNDING":
      domainResult = applyForFanFunding(state, envelope.payload.date);
      break;
    case "APPLY_ADS":
      domainResult = applyForAds(state, envelope.payload.date);
      break;
    case "ACCEPT_SPONSOR":
      domainResult = acceptSponsorship(state, envelope.payload.offerId, envelope.payload.date);
      break;
    case "SET_MEMBERSHIP_POLICY":
      domainResult = setMembershipPolicy(state, envelope.payload);
      break;
    case "PAY_REFUND_PAYABLE":
      domainResult = payRefundPayable(state, envelope.payload);
      break;
    case "CREATE_MERCH_PROJECT":
      domainResult = createMerchProject(state, envelope.payload);
      break;
    case "CONFIRM_MERCH_PROJECT":
      domainResult = confirmMerchProject(state, envelope.payload);
      break;
    case "PROCESS_MERCH_DATE":
      domainResult = processMerchProjectDate(state, envelope.payload);
      break;
    case "OPEN_MERCH_SALES":
      domainResult = openMerchSales(state, envelope.payload);
      break;
    case "PROMOTE_MERCH_PROJECT":
      domainResult = promoteMerchProject(state, envelope.payload);
      break;
    case "CLOSE_MERCH_SALES":
      domainResult = closeMerchSales(state, envelope.payload);
      break;
    case "BEGIN_MERCH_PRODUCTION":
      domainResult = beginMerchProduction(state, envelope.payload);
      break;
    case "RESOLVE_MERCH_MOQ":
      domainResult = resolveUnderMoq(state, envelope.payload);
      break;
    case "START_MERCH_FULFILLMENT":
      domainResult = startMerchFulfillment(state, envelope.payload);
      break;
    case "SETTLE_MERCH_PROJECT":
      domainResult = settleMerchProject(state, envelope.payload);
      break;
    case "CANCEL_MERCH_PROJECT":
      domainResult = cancelMerchProject(state, envelope.payload);
      break;
    case "REFUND_DELIVERED_MERCH":
      domainResult = refundDeliveredMerch(state, envelope.payload);
      break;
    case "PAY_MERCH_REFUND_PAYABLE":
      domainResult = payMerchRefundPayable(state, envelope.payload);
      break;
    case "CREATE_LONG_PROJECT":
      domainResult = createLongProject(state, envelope.payload);
      break;
    case "SUBMIT_LONG_PROJECT":
      domainResult = submitLongProject(state, envelope.payload);
      break;
    case "APPROVE_LONG_PROJECT":
      domainResult = approveLongProject(state, envelope.payload);
      break;
    case "START_LONG_PROJECT":
      domainResult = startLongProject(state, envelope.payload);
      break;
    case "ENTER_LONG_PROJECT_PRODUCTION":
      domainResult = enterLongProjectProduction(state, envelope.payload);
      break;
    case "PROCESS_LONG_PROJECT_DATE":
      domainResult = processLongProjectDate(state, envelope.payload);
      break;
    case "PASS_LONG_PROJECT_QUALITY":
      domainResult = passLongProjectQuality(state, envelope.payload);
      break;
    case "PUBLISH_LONG_PROJECT":
      domainResult = publishLongProject(state, envelope.payload);
      break;
    case "ADVANCE_LONG_PROJECT_TAIL":
      domainResult = advanceLongProjectTail(state, envelope.payload);
      break;
    case "ARCHIVE_LONG_PROJECT":
      domainResult = archiveLongProject(state, envelope.payload);
      break;
    case "PAUSE_LONG_PROJECT":
      domainResult = pauseLongProject(state, envelope.payload);
      break;
    case "RESUME_LONG_PROJECT":
      domainResult = resumeLongProject(state, envelope.payload);
      break;
    case "CANCEL_LONG_PROJECT":
      domainResult = cancelLongProject(state, envelope.payload);
      break;
    case "CREATE_AUDITION_APPLICATION":
      domainResult = createAuditionApplication(state, envelope.payload);
      break;
    case "SUBMIT_APPLICATION":
      domainResult = await submitAuditionApplication(state, envelope.payload);
      break;
    case "START_AUDITION_SCREENING":
      domainResult = startAuditionScreening(state, envelope.payload);
      break;
    case "RESOLVE_AUDITION_SCREENING":
      domainResult = resolveAuditionScreening(state, envelope.payload);
      break;
    case "REQUEST_AUDITION_EXTENSION":
      domainResult = requestAuditionOfferExtension(state, envelope.payload);
      break;
    case "BEGIN_AUDITION_CONTRACT_REVIEW":
      domainResult = beginAuditionContractReview(state, envelope.payload);
      break;
    case "ACCEPT_AUDITION_CONTRACT_REVIEW":
      domainResult = acceptAuditionContractReview(state, envelope.payload);
      break;
    case "COMPLETE_AUDITION":
      domainResult = completeAudition(state, envelope.payload);
      break;
    case "WITHDRAW_AUDITION":
      domainResult = withdrawAudition(state, envelope.payload);
      break;
    case "REQUEST_AGENCY_RESOURCE":
      domainResult = await requestAgencyResource(state, envelope.payload);
      break;
    case "RESOLVE_AGENCY_RESOURCE":
      domainResult = resolveAgencyResourceBatch(state, envelope.payload);
      break;
    case "CREATE_TRANSFER_CASE":
      domainResult = createTransferCase(state, envelope.payload);
      break;
    case "BEGIN_TRANSFER_EXIT_NEGOTIATION":
      domainResult = beginTransferExitNegotiation(state, envelope.payload);
      break;
    case "CONFIRM_TRANSFER_PLAN":
      domainResult = confirmTransferPlan(state, envelope.payload);
      break;
    case "RESUME_TRANSFER":
      domainResult = resumeTransfer(state, envelope.payload);
      break;
    case "START_TRANSFER_NOTICE":
      domainResult = startTransferNotice(state, envelope.payload);
      break;
    case "PROCESS_TRANSFER_NOTICE":
      domainResult = processTransferNotice(state, envelope.payload);
      break;
    case "SWITCH_AFFILIATION":
      domainResult = switchAffiliation(state, envelope.payload);
      break;
    case "CLOSE_TRANSFER":
      domainResult = closeTransfer(state, envelope.payload);
      break;
    case "CANCEL_TRANSFER":
      domainResult = cancelTransfer(state, envelope.payload);
      break;
    case "SUBMIT_INVITATION":
      domainResult = submitCollaborationInvitation(state, envelope.payload);
      break;
    case "RESPOND_NPC_INVITATION":
      domainResult = respondToNpcInvitation(state, envelope.payload);
      break;
    case "RESOLVE_TEXT_EVENT":
      domainResult = resolveTextEvent(state, envelope.payload);
      break;
    case "ACKNOWLEDGE_TUTORIAL_STEP":
      domainResult = acknowledgeTutorialStep(state, envelope.payload);
      break;
    case "SKIP_TUTORIAL":
      domainResult = skipTutorial(state);
      break;
    case "CONTINUE_AFTER_RETROSPECTIVE":
      domainResult = continueAfterRetrospective(state);
      break;
    case "END_CAREER":
      domainResult = endCareer(state, envelope.payload);
      break;
    case "CREATE_PROPAGATION_COMMISSION":
      domainResult = createPropagationCommission(state, envelope.payload);
      break;
    case "UPDATE_PREFERENCES":
      domainResult = updatePreferences(state, envelope.payload);
      break;
    case "CHANGE_CONTENT_VISIBILITY":
      domainResult = changeContentVisibility(state, envelope.payload);
      break;
    case "PREVIEW_WEEK":
      return { ok: true, state, preview: previewWeek(state), snapshotVersion: state.snapshotVersion, phase: state.phase, replayed: false };
    default:
      return failure("INVALID_COMMAND", "未知命令类型", { type: envelope.type });
  }
  if (!domainResult.ok) return failure(domainResult.code, domainResult.message, domainResult.details || {});
  const next = domainResult.state;
  const response = {
    ok: true,
    snapshotVersion: next.snapshotVersion,
    phase: next.phase,
    emittedEventIds: domainResult.report ? [`weekly_report_${domainResult.report.weekIndex}`] : [],
  };
  next.commandRecords.push({ commandId: envelope.command_id, payloadHash: hash, result: response, committedSnapshotVersion: next.snapshotVersion });
  return { ...response, state: next, report: domainResult.report, replayed: false };
}

export function commandEnvelope(state, type, payload, commandId = crypto.randomUUID()) {
  return {
    command_id: commandId,
    game_id: state.id,
    expected_snapshot_version: state.snapshotVersion,
    type,
    payload,
  };
}
