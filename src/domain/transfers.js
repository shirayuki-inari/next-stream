import { AGENCIES, ROUTES } from "../../rules/agency_profiles.js";
import { BALANCE } from "../../rules/balance_standard_0_1.js";

const ACTIVE_STATES = new Set(["EXPLORING", "DESTINATION_CONFIRMED", "EXIT_NEGOTIATION", "ASSET_AND_OBLIGATION_PLAN", "NOTICE_PERIOD", "READY_TO_SWITCH", "REBUILDING", "PAUSED"]);
const PLAN_TYPES = new Set(["KEEP_ALL", "KEEP_CHARACTER_NEW_CHANNEL", "NEW_IDENTITY"]);

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function context(sourceState, transferId, statuses) {
  if (sourceState.phase !== "PLANNING") return { error: { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段处理转籍" } };
  const original = sourceState.transferCases?.find((item) => item.id === transferId);
  if (!original || !statuses.includes(original.status)) return { error: { ok: false, code: "TRANSFER_REQUIREMENTS_UNMET", message: "转籍案不存在或当前阶段不可执行此操作" } };
  const state = structuredClone(sourceState);
  return { state, transfer: state.transferCases.find((item) => item.id === transferId) };
}

function activeCharacterAsset(state) {
  return state.assets.find((asset) => state.character.assetIds.includes(asset.id) && asset.type === "AVATAR") || state.assets.find((asset) => asset.characterId === state.character.id);
}

function canRetainCharacter(state) {
  const asset = activeCharacterAsset(state);
  if (!asset) return false;
  if (asset.ownerParty === "PLAYER") return true;
  return state.licenses.some((license) => license.assetId === asset.id && license.licenseeParty === "PLAYER" && license.survivesTermination && (!license.effectiveTo || license.effectiveTo >= state.createdAt));
}

function canRetainChannel(state) {
  return state.channel.controller === "PLAYER";
}

function obligations(state) {
  const items = [];
  for (const project of state.projects || []) {
    if (project.type === "MERCH" && Number(project.orderCount || 0) > Number(project.deliveredOrders || 0)) items.push({ id: project.id, type: "UNDELIVERED_MERCH", label: `${project.title} · 未交付 ${Number(project.orderCount || 0) - Number(project.deliveredOrders || 0)} 件`, responsibleParty: project.fulfillmentParty, treatment: null });
    if (project.type === "LONG_TERM" && !["LONG_TAIL", "CANCELLED", "ARCHIVED"].includes(project.status)) items.push({ id: project.id, type: "ACTIVE_PROJECT", label: `${project.title} · ${project.status}`, responsibleParty: project.fundingParty, treatment: null });
  }
  for (const deal of state.sponsorships || []) if (deal.status === "ACCEPTED") items.push({ id: deal.id, type: "SPONSOR_DELIVERY", label: `${deal.brandName} · 待交付`, responsibleParty: deal.contractSnapshot?.agencyId || "PLAYER", treatment: null });
  return items;
}

function completedAudition(state, targetAgencyId) {
  return [...(state.auditionApplications || [])].reverse().find((item) => item.status === "COMPLETED" && item.transferEligibility?.granted && item.transferEligibility.agencyId === targetAgencyId);
}

export function createTransferCase(sourceState, { targetRouteId, date }) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段建立转籍案" };
  if (!ROUTES[targetRouteId] || targetRouteId === sourceState.routeId) return { ok: false, code: "INVALID_COMMAND", message: "目标所属无效或与当前所属相同" };
  if (sourceState.transferCases?.some((item) => ACTIVE_STATES.has(item.status))) return { ok: false, code: "TRANSFER_REQUIREMENTS_UNMET", message: "已有进行中的主所属转籍案" };
  const targetAgencyId = ROUTES[targetRouteId].agencyId;
  const audition = targetAgencyId ? completedAudition(sourceState, targetAgencyId) : null;
  if (targetAgencyId && !audition) return { ok: false, code: "TRANSFER_REQUIREMENTS_UNMET", message: "加盟企业前必须先完成该机构的招募与合同审阅" };
  const state = structuredClone(sourceState);
  const transfer = {
    id: `transfer_${state.id}_${state.transferCases.length + 1}`,
    performerId: state.performer.id,
    sourceRouteId: state.routeId,
    sourceAgencyId: state.affiliation?.agencyId || null,
    targetRouteId,
    targetAgencyId,
    sourceAffiliationId: state.affiliation.id,
    sourceContractId: state.contract?.id || null,
    destinationApplicationId: audition?.id || null,
    status: targetAgencyId ? "DESTINATION_CONFIRMED" : "EXIT_NEGOTIATION",
    exitChecklist: {
      noticePeriod: { requiredWeeks: state.contract?.noticeWeeks || 0, status: state.contract ? "PENDING" : "NOT_REQUIRED" },
      obligations: obligations(state),
      assets: { status: "PENDING" },
      channelControl: { status: "PENDING" },
      financialItems: { openReceivableIds: state.history.receivables.filter((item) => item.status === "OPEN").map((item) => item.id), openPayableJpy: state.cash.payable, treatment: "RETAIN_ORIGINAL_CONTRACT" },
      announcement: { status: "PLANNED", publicScope: "只公开已确认信息" },
      newIdentity: { status: "PENDING" },
    },
    assetPlan: null,
    identityPreparation: null,
    createdAt: date,
    lastActionAt: date,
  };
  state.transferCases.push(transfer);
  state.snapshotVersion += 1;
  return { ok: true, state, transfer };
}

export function beginTransferExitNegotiation(sourceState, { transferId, date }) {
  const result = context(sourceState, transferId, ["DESTINATION_CONFIRMED"]);
  if (result.error) return result.error;
  result.transfer.status = "EXIT_NEGOTIATION";
  result.transfer.lastActionAt = date;
  result.state.snapshotVersion += 1;
  return { ok: true, state: result.state, transfer: result.transfer };
}

export function confirmTransferPlan(sourceState, { transferId, assetPlanType, obligationTreatment = "PRESERVE_EXISTING_RESPONSIBILITY", date }) {
  const result = context(sourceState, transferId, ["EXIT_NEGOTIATION"]);
  if (result.error) return result.error;
  const { state, transfer } = result;
  if (!PLAN_TYPES.has(assetPlanType)) return { ok: false, code: "INVALID_COMMAND", message: "资产方案无效" };
  if (["KEEP_ALL", "KEEP_CHARACTER_NEW_CHANNEL"].includes(assetPlanType) && !canRetainCharacter(state)) return { ok: false, code: "ASSET_LICENSE_REQUIRED", message: "当前角色资产没有终止后有效的玩家使用许可，不能带入新活动" };
  if (assetPlanType === "KEEP_ALL" && !canRetainChannel(state)) return { ok: false, code: "CHANNEL_TRANSFER_DENIED", message: "原频道控制权不可转移；请选择保留角色并新建频道，或使用新身份" };
  if (obligationTreatment !== "PRESERVE_EXISTING_RESPONSIBILITY") return { ok: false, code: "TRANSFER_REQUIREMENTS_UNMET", message: "首版只允许保留原项目与原责任主体，不能把未交付订单变成无主责任" };
  transfer.assetPlan = { type: assetPlanType, characterRetained: assetPlanType !== "NEW_IDENTITY", channelRetained: assetPlanType === "KEEP_ALL", confirmedAt: date };
  transfer.exitChecklist.assets.status = "PLANNED";
  transfer.exitChecklist.channelControl.status = "PLANNED";
  for (const item of transfer.exitChecklist.obligations) item.treatment = obligationTreatment;
  if (assetPlanType === "NEW_IDENTITY") {
    const playerFunded = transfer.targetRouteId === "indie";
    const costJpy = playerFunded ? 50000n : 0n;
    transfer.identityPreparation = { requiredUnits: 2, completedUnits: 0, earliestReadyDate: addDays(date, 14), costJpy: String(costJpy), fundingParty: playerFunded ? "PLAYER" : transfer.targetAgencyId, funded: false };
    if (BigInt(state.cash.free) < costJpy) {
      transfer.status = "PAUSED";
      transfer.pauseReason = "新身份最低方案需要 50,000 日元；可先暂停活动或兼职，资金不会因此阻止进入退出流程。";
      transfer.lastActionAt = date;
      state.snapshotVersion += 1;
      return { ok: true, state, transfer };
    }
    if (costJpy > 0n) {
      state.cash.free = String(BigInt(state.cash.free) - costJpy);
      state.finance.longTermProjectExpense = String(BigInt(state.finance.longTermProjectExpense || 0) + costJpy);
      state.history.journalEntries.push({ id: `journal_${transfer.id}_identity`, date, sourceId: transfer.id, lines: [{ account: "IDENTITY_ASSET_EXPENSE", debit: String(costJpy), credit: "0", projectId: transfer.id }, { account: "CASH_FREE", debit: "0", credit: String(costJpy), projectId: transfer.id }] });
    }
    transfer.identityPreparation.funded = true;
    transfer.exitChecklist.newIdentity.status = "IN_PROGRESS";
  } else transfer.exitChecklist.newIdentity.status = "NOT_REQUIRED";
  transfer.status = "ASSET_AND_OBLIGATION_PLAN";
  transfer.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, transfer };
}

export function resumeTransfer(sourceState, { transferId, date }) {
  const result = context(sourceState, transferId, ["PAUSED"]);
  if (result.error) return result.error;
  const { state, transfer } = result;
  const cost = BigInt(transfer.identityPreparation?.costJpy || 0);
  if (BigInt(state.cash.free) < cost) return { ok: false, code: "INSUFFICIENT_FREE_CASH", message: `恢复新身份准备需要 ${cost} 日元自由现金；退出案仍会保留` };
  state.cash.free = String(BigInt(state.cash.free) - cost);
  if (cost > 0n) {
    state.finance.longTermProjectExpense = String(BigInt(state.finance.longTermProjectExpense || 0) + cost);
    state.history.journalEntries.push({ id: `journal_${transfer.id}_identity`, date, sourceId: transfer.id, lines: [{ account: "IDENTITY_ASSET_EXPENSE", debit: String(cost), credit: "0", projectId: transfer.id }, { account: "CASH_FREE", debit: "0", credit: String(cost), projectId: transfer.id }] });
  }
  transfer.identityPreparation.funded = true;
  transfer.status = "ASSET_AND_OBLIGATION_PLAN";
  transfer.exitChecklist.newIdentity.status = "IN_PROGRESS";
  transfer.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, transfer };
}

export function applyTransferPreparation(state, transferId, date) {
  const transfer = state.transferCases.find((item) => item.id === transferId);
  if (!transfer || transfer.status !== "ASSET_AND_OBLIGATION_PLAN" || !transfer.identityPreparation?.funded || transfer.identityPreparation.completedUnits >= transfer.identityPreparation.requiredUnits) throw new Error("TRANSFER_REQUIREMENTS_UNMET");
  transfer.identityPreparation.completedUnits += 1;
  transfer.lastActionAt = date;
  if (transfer.identityPreparation.completedUnits >= transfer.identityPreparation.requiredUnits) transfer.exitChecklist.newIdentity.status = "WORK_COMPLETE";
  return transfer;
}

export function startTransferNotice(sourceState, { transferId, date }) {
  const result = context(sourceState, transferId, ["ASSET_AND_OBLIGATION_PLAN"]);
  if (result.error) return result.error;
  const { state, transfer } = result;
  if (transfer.exitChecklist.obligations.some((item) => !item.treatment)) return { ok: false, code: "TRANSFER_REQUIREMENTS_UNMET", message: "未交付项目与订单尚未逐项保存责任处理方式" };
  if (transfer.identityPreparation && (transfer.identityPreparation.completedUnits < 2 || date < transfer.identityPreparation.earliestReadyDate)) return { ok: false, code: "TRANSFER_REQUIREMENTS_UNMET", message: `新身份需要 2 格准备并等待至 ${transfer.identityPreparation.earliestReadyDate}` };
  transfer.exitChecklist.assets.status = "CONFIRMED";
  transfer.exitChecklist.channelControl.status = "CONFIRMED";
  if (transfer.identityPreparation) transfer.exitChecklist.newIdentity.status = "READY";
  const weeks = transfer.exitChecklist.noticePeriod.requiredWeeks;
  transfer.noticeEndsAt = addDays(date, weeks * 7);
  transfer.status = weeks > 0 ? "NOTICE_PERIOD" : "READY_TO_SWITCH";
  transfer.exitChecklist.noticePeriod.status = weeks > 0 ? "IN_PROGRESS" : "NOT_REQUIRED";
  transfer.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, transfer };
}

export function processTransferNotice(sourceState, { transferId, date }) {
  const result = context(sourceState, transferId, ["NOTICE_PERIOD"]);
  if (result.error) return result.error;
  if (date < result.transfer.noticeEndsAt) return { ok: false, code: "TOO_EARLY", message: `通知期将在 ${result.transfer.noticeEndsAt} 结束` };
  result.transfer.status = "READY_TO_SWITCH";
  result.transfer.exitChecklist.noticePeriod.status = "COMPLETE";
  result.transfer.lastActionAt = date;
  result.state.snapshotVersion += 1;
  return { ok: true, state: result.state, transfer: result.transfer };
}

function resetChannel(state, transfer, date, newCharacterId) {
  const oldChannel = structuredClone(state.channel);
  oldChannel.archivedAt = date;
  oldChannel.archivedSubscribers = oldChannel.subscribers;
  state.historicalChannels.push(oldChannel);
  state.channel = { id: `channel_${state.id}_transfer_${state.historicalChannels.length}`, characterId: newCharacterId, platformId: oldChannel.platformId, controller: transfer.targetAgencyId || "PLAYER", subscribers: 0, fanFundingStatus: "INELIGIBLE", adsStatus: "INELIGIBLE", adsFeatureEnabled: false, scFeatureEnabled: false, membershipFeatureEnabled: false, commerceTermsAccepted: false, creatorIsAdult: oldChannel.creatorIsAdult, regionAvailable: oldChannel.regionAvailable, channelStanding: "GOOD", validPublicUploads90d: 0, validWatchMinutes12m: 0, shortsViews90d: 0 };
  for (const segment of state.audienceSegments) segment.subscribers = 0;
  transfer.audienceMigration = { oldChannelId: oldChannel.id, newChannelId: state.channel.id, stableViewerEstimate: Math.floor(Number(state.metrics.active28dEstimate || 0) * 0.60 * 0.65 * 0.80), contactSchedule: [0.4, 0.3, 0.2, 0.1], subscriberCopy: false };
}

export function switchAffiliation(sourceState, { transferId, date }) {
  const result = context(sourceState, transferId, ["READY_TO_SWITCH"]);
  if (result.error) return result.error;
  const { state, transfer } = result;
  const oldAffiliation = { ...state.affiliation, effectiveTo: date };
  state.affiliationHistory.push(oldAffiliation);
  if (state.contract) {
    state.contract.terminatedAt = date;
    state.contractHistory.push(structuredClone(state.contract));
  }
  for (const license of state.licenses) if (!license.survivesTermination && !license.effectiveTo) license.effectiveTo = date;
  const targetRoute = ROUTES[transfer.targetRouteId];
  const contractId = targetRoute.agencyId ? `contract_${state.id}_transfer_${state.contractHistory.length + 1}` : null;
  state.contract = contractId ? { id: contractId, version: 1, creatorPlatformShareBps: targetRoute.creatorShareBps, termWeeks: BALANCE.contracts.defaultTermWeeks, noticeWeeks: BALANCE.contracts.defaultNoticeWeeks, signed: true, signedAt: date, effectiveFrom: date, allowsExternalAuditions: true, sourceType: "DESIGN_VALUE" } : null;
  state.affiliation = { id: `affiliation_${state.id}_transfer_${state.affiliationHistory.length + 1}`, performerId: state.performer.id, agencyId: targetRoute.agencyId, contractId, effectiveFrom: date, effectiveTo: null };
  state.routeId = targetRoute.id;
  if (transfer.assetPlan.type === "KEEP_ALL") {
    if (targetRoute.agencyId) for (const assetId of state.character.assetIds) state.licenses.push({ assetId, licenseeParty: targetRoute.agencyId, allowedUses: ["STREAM", "VIDEO", "PROMOTION"], effectiveFrom: date, effectiveTo: null, canModify: false, canSublicense: false, survivesTermination: false });
  } else if (transfer.assetPlan.type === "KEEP_CHARACTER_NEW_CHANNEL") resetChannel(state, transfer, date, state.character.id);
  else {
    const oldCharacter = structuredClone(state.character);
    oldCharacter.active = false;
    oldCharacter.archivedAt = date;
    state.historicalCharacters.push(oldCharacter);
    const newCharacterId = `character_${state.id}_transfer_${state.historicalCharacters.length}`;
    const assetId = `asset_${state.id}_transfer_${state.assets.length + 1}`;
    state.character = { id: newCharacterId, performerId: state.performer.id, name: `${state.performer.code} / NEW`, active: true, assetIds: [assetId], visualProductionBonus: 0, outfitRevealWindows: 0, merchMaterialAssetIds: [] };
    state.assets.push({ id: assetId, type: "AVATAR", ownerParty: targetRoute.agencyId || "PLAYER", characterId: newCharacterId, transferId: transfer.id });
    state.licenses.push({ assetId, licenseeParty: "PLAYER", allowedUses: ["STREAM", "VIDEO", "COMMERCIAL"], effectiveFrom: date, effectiveTo: null, canModify: !targetRoute.agencyId, canSublicense: false, survivesTermination: !targetRoute.agencyId });
    resetChannel(state, transfer, date, newCharacterId);
  }
  transfer.status = "REBUILDING";
  transfer.switchedAt = date;
  transfer.oldContractSettlementPreserved = true;
  transfer.noDualAffiliation = true;
  transfer.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, transfer };
}

export function closeTransfer(sourceState, { transferId, date }) {
  const result = context(sourceState, transferId, ["REBUILDING"]);
  if (result.error) return result.error;
  result.transfer.status = "CLOSED";
  result.transfer.closedAt = date;
  result.transfer.lastActionAt = date;
  result.state.snapshotVersion += 1;
  return { ok: true, state: result.state, transfer: result.transfer };
}

export function cancelTransfer(sourceState, { transferId, date }) {
  const result = context(sourceState, transferId, [...ACTIVE_STATES]);
  if (result.error) return result.error;
  result.transfer.status = "CANCELLED";
  result.transfer.cancelledAt = date;
  result.transfer.lastActionAt = date;
  result.state.snapshotVersion += 1;
  return { ok: true, state: result.state, transfer: result.transfer };
}
