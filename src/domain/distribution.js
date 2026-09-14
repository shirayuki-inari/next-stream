import { DISTRIBUTION_SERVICES } from "../../rules/distribution_services.js";

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function createPropagationCommission(sourceState, { sourceContentId, serviceType, targetLanguage = null, date }) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "只能在排期阶段创建传播委托" };
  const service = DISTRIBUTION_SERVICES[serviceType];
  const source = sourceState.history.contents.find((content) => content.id === sourceContentId && content.visibility === "PUBLIC");
  if (!service || !source) return { ok: false, code: "REQUIREMENT_UNMET", message: "服务不存在，或源内容不是可授权的公开内容" };
  if (serviceType === "SUBTITLE_TRANSLATION" && !["jp", "en"].includes(targetLanguage)) return { ok: false, code: "LICENSE_SCOPE_INVALID", message: "翻译委托必须指定日语或英语目标" };
  if (sourceState.propagationCommissions.some((item) => item.sourceContentId === sourceContentId && item.serviceType === serviceType && item.targetLanguage === targetLanguage && !["CANCELLED", "APPLIED"].includes(item.status))) return { ok: false, code: "COMMISSION_ALREADY_EXISTS", message: "同一内容已有相同范围的传播委托" };
  if (BigInt(sourceState.cash.free) < service.costJpy) return { ok: false, code: "INSUFFICIENT_FREE_CASH", message: "自由现金不足；公开内容不会被默认授权给第三方" };
  const state = structuredClone(sourceState);
  const content = state.history.contents.find((item) => item.id === sourceContentId);
  const id = `propagation_${sourceContentId}_${serviceType.toLowerCase()}_${state.propagationCommissions.length + 1}`;
  state.cash.free = String(BigInt(state.cash.free) - service.costJpy);
  const commission = {
    id,
    sourceContentId,
    serviceType,
    targetLanguage: serviceType === "SUBTITLE_TRANSLATION" ? targetLanguage : null,
    status: "IN_PROGRESS",
    orderedAt: date,
    dueDate: addDays(date, service.deliveryDays),
    costJpy: String(service.costJpy),
    licenseTag: service.licenseTag,
    licenseScope: serviceType === "CLIP_EDIT" ? "PUBLIC_EXCERPT_ONLY" : "PLAYER_AUTHORIZED_SUBTITLE_ONLY",
    thirdPartyMaterialPolicy: "NO_UNLICENSED_REUSE",
  };
  state.propagationCommissions.push(commission);
  content.propagationLicenses ??= [];
  content.propagationLicenses.push({ commissionId: id, licenseTag: service.licenseTag, scope: commission.licenseScope, effectiveFrom: date });
  state.history.journalEntries.push({ id: `journal_${id}`, date, sourceId: id, lines: [{ account: "DISTRIBUTION_SERVICE_EXPENSE", debit: String(service.costJpy), credit: "0" }, { account: "CASH_FREE", debit: "0", credit: String(service.costJpy) }] });
  state.snapshotVersion += 1;
  return { ok: true, state, commission };
}

export function processPropagationCommissions(state, date) {
  for (const commission of state.propagationCommissions || []) {
    if (commission.status !== "IN_PROGRESS" || commission.dueDate > date) continue;
    const source = state.history.contents.find((content) => content.id === commission.sourceContentId);
    const service = DISTRIBUTION_SERVICES[commission.serviceType];
    commission.status = "READY";
    commission.completedAt = date;
    const event = {
      id: `propagation_event_${commission.id}`,
      commissionId: commission.id,
      sourceContentId: source.id,
      occurredAt: date,
      type: commission.serviceType,
      licenseTag: commission.licenseTag,
      remainingImpressionBoost: Math.max(120, Math.round(Number(source.uniqueEstimate || 0) * service.reachRate)),
      status: "READY",
    };
    state.propagationEvents.push(event);
    commission.propagationEventId = event.id;
  }
}

export function availablePropagationBoost(state) {
  return (state.propagationEvents || []).filter((event) => event.status === "READY").reduce((sum, event) => sum + Number(event.remainingImpressionBoost || 0), 0);
}

export function consumePropagationBoost(state, contentId) {
  for (const event of state.propagationEvents || []) {
    if (event.status !== "READY") continue;
    event.status = "APPLIED";
    event.appliedToContentId = contentId;
    event.remainingImpressionBoost = 0;
    const commission = state.propagationCommissions.find((item) => item.id === event.commissionId);
    if (commission) commission.status = "APPLIED";
  }
}
