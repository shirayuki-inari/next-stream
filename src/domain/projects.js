import { BALANCE } from "../../rules/balance_standard_0_1.js";
import { isAgencySharedResource } from "./resources.js";

const TEMPLATES = new Map(Object.values(BALANCE.longProjects).map((template) => [template.id, template]));
const TERMINAL_STATES = new Set(["LONG_TAIL", "CANCELLED", "ARCHIVED"]);
const PAUSABLE_STATES = new Set(["DRAFT", "REVIEW", "APPROVED", "PRE_PRODUCTION", "PRODUCTION", "QUALITY_CHECK", "SCHEDULED"]);

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function compareIso(a, b) {
  return String(a).localeCompare(String(b));
}

function pushJournal(state, entry) {
  const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit || 0), 0n);
  const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit || 0), 0n);
  if (debit !== credit) throw new Error("UNBALANCED_JOURNAL");
  state.history.journalEntries.push(entry);
}

function mutateProject(sourceState, projectId, allowedStates) {
  if (sourceState.phase !== "PLANNING") return { error: { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段修改长期项目" } };
  const original = sourceState.projects?.find((item) => item.id === projectId && item.type === "LONG_TERM");
  if (!original || !allowedStates.includes(original.status)) return { error: { ok: false, code: "REQUIREMENT_UNMET", message: "长期项目不存在或当前阶段不可执行此操作" } };
  const state = structuredClone(sourceState);
  return { state, project: state.projects.find((item) => item.id === projectId) };
}

function paymentNodes(budgetJpy) {
  const budget = BigInt(budgetJpy);
  const startup = budget * 30n / 100n;
  const production = budget * 40n / 100n;
  return { startupJpy: String(startup), productionJpy: String(production), acceptanceJpy: String(budget - startup - production) };
}

function spendNode(state, project, node, date) {
  const key = `${node}Jpy`;
  const amount = BigInt(project.paymentPlan[key]);
  if (project.paymentPlan.paidNodes.includes(node)) return { ok: false, code: "REQUIREMENT_UNMET", message: "该付款节点已经确认" };
  if (BigInt(state.cash.free) < amount) return { ok: false, code: "INSUFFICIENT_FREE_CASH", message: "自由现金不足；项目不能动用商品预售或其他履约受限资金" };
  state.cash.free = String(BigInt(state.cash.free) - amount);
  project.spentCostJpy = String(BigInt(project.spentCostJpy) + amount);
  project.paymentPlan.paidNodes.push(node);
  pushJournal(state, {
    id: `journal_${project.id}_${node}`,
    date,
    sourceId: project.id,
    lines: [
      { account: "LONG_TERM_PROJECT_EXPENSE", debit: String(amount), credit: "0", projectId: project.id, contractId: project.contractSnapshotId },
      { account: "CASH_FREE", debit: "0", credit: String(amount), projectId: project.id, contractId: project.contractSnapshotId },
    ],
  });
  state.finance.longTermProjectExpense = String(BigInt(state.finance.longTermProjectExpense || 0) + amount);
  return { ok: true };
}

function reserveResources(state, project, template, startDate) {
  const requirements = template.resourceRequirements.filter((requirement) => !requirement.companyOnly || state.affiliation?.agencyId);
  project.requiredResources = structuredClone(requirements);
  project.reservedResourceIds = [];
  project.pendingResourceRequirements = [];
  requirements.forEach((requirement, index) => {
    const offset = Math.min(template.minimumCalendarDays - 1, 7 * (index + 1));
    const desiredDate = addDays(startDate, offset);
    if (state.affiliation?.agencyId && isAgencySharedResource(requirement.resourceType)) {
      project.pendingResourceRequirements.push({ resourceType: requirement.resourceType, quantity: requirement.quantity, desiredDate, status: "UNREQUESTED", requestId: null, allocatedQuantity: 0 });
      return;
    }
    const reservation = {
      id: `resource_${project.id}_${index + 1}`,
      providerParty: requirement.companyOnly ? state.affiliation.agencyId : "EXTERNAL_SUPPLIER",
      resourceType: requirement.resourceType,
      date: desiredDate,
      quantity: requirement.quantity,
      projectId: project.id,
      status: "RESERVED",
      includedInBudget: true,
    };
    state.resourceReservations.push(reservation);
    project.reservedResourceIds.push(reservation.id);
  });
}

function allResourcesReserved(state, project) {
  return project.requiredResources.every((requirement) => {
    const allocated = project.reservedResourceIds
      .map((id) => state.resourceReservations.find((item) => item.id === id))
      .filter((item) => item?.resourceType === requirement.resourceType && ["RESERVED", "FULFILLED"].includes(item.status))
      .reduce((sum, item) => sum + item.quantity, 0);
    return allocated >= requirement.quantity;
  });
}

export function createLongProject(sourceState, { templateId = BALANCE.longProjects.newOutfit.id, title, date } = {}) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段建立长期项目草案" };
  const template = TEMPLATES.get(templateId);
  if (!template) return { ok: false, code: "INVALID_COMMAND", message: "长期项目模板无效" };
  if (sourceState.projects?.some((project) => project.type === "LONG_TERM" && !TERMINAL_STATES.has(project.status))) return { ok: false, code: "PROJECT_CONFLICT", message: "已有未结束的长期项目" };
  const state = structuredClone(sourceState);
  const projectNumber = state.projects.filter((item) => item.type === "LONG_TERM").length + 1;
  const ownerParty = state.routeId === "indie" ? "PLAYER" : state.affiliation.agencyId;
  const project = {
    id: `long_${state.id}_${projectNumber}`,
    type: "LONG_TERM",
    templateId: template.id,
    projectType: template.projectType,
    goal: template.name,
    title: String(title || template.name).trim().slice(0, 32) || template.name,
    status: "DRAFT",
    ownerParty,
    fundingOwner: "PLAYER",
    assetPermission: { plannedOwnerParty: ownerParty, playerUses: ["STREAM", "VIDEO"], merchMaterialEligible: template.projectType === "NEW_OUTFIT", merchSaleLicenseGranted: ownerParty === "PLAYER" },
    fixedBudgetJpy: String(template.budgetJpy),
    variableCostJpy: "0",
    workRequired: template.workUnits,
    workCompleted: 0,
    externalWaitDays: template.minimumCalendarDays,
    requiredResources: [],
    reservedResourceIds: [],
    pendingResourceRequirements: [],
    stageDependencies: {
      PRODUCTION: ["STARTUP_PAID", "PRODUCTION_PAID", "RESOURCES_RESERVED"],
      QUALITY_CHECK: ["WORK_COMPLETE", "MINIMUM_CALENDAR_REACHED", "RESOURCES_RESERVED"],
      SCHEDULED: ["QUALITY_CHECK_PASSED", "ACCEPTANCE_PAID"],
      PUBLISHED: ["ALL_PAYMENT_NODES_PAID", "ASSET_PERMISSION_RECORDED"],
    },
    deliveryDate: null,
    failureAndCancellation: "未发布前保留已确认成本并取消资源预约；发布后仅可归档，不删除作品与记录。",
    completedAssetIds: [],
    downstreamRevenueBasis: template.effect.longTail ? "独立作品记录、评价、长尾与作品集；不保证回本。" : "一次展示宣传窗口与合规商品素材；不产生全局订阅倍率。",
    contractSnapshotId: state.contract?.id || null,
    contractSnapshot: state.contract ? { id: state.contract.id, version: state.contract.version, fundingOwner: "PLAYER", assetOwnerParty: ownerParty } : null,
    paymentPlan: { ...paymentNodes(template.budgetJpy), paidNodes: [] },
    spentCostJpy: "0",
    startedAt: null,
    earliestPublishDate: null,
    qualityCheck: { status: "PENDING", checkedAt: null },
    scheduledPublishDate: null,
    publishedAt: null,
    longTailStartedAt: null,
    cancellationTreatment: null,
    pausedFromStatus: null,
    createdAt: date,
    lastActionAt: date,
  };
  state.projects.push(project);
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function submitLongProject(sourceState, { projectId, date }) {
  const context = mutateProject(sourceState, projectId, ["DRAFT"]);
  if (context.error) return context.error;
  const { state, project } = context;
  project.status = state.routeId === "indie" ? "APPROVED" : "REVIEW";
  project.reviewSubmittedAt = date;
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function approveLongProject(sourceState, { projectId, date }) {
  const context = mutateProject(sourceState, projectId, ["REVIEW"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (!state.affiliation?.agencyId) return { ok: false, code: "REQUIREMENT_UNMET", message: "个人项目无需外部审核，可从草案直接进入已批准" };
  project.status = "APPROVED";
  project.approvedAt = date;
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function startLongProject(sourceState, { projectId, date }) {
  const context = mutateProject(sourceState, projectId, ["APPROVED"]);
  if (context.error) return context.error;
  const { state, project } = context;
  const template = TEMPLATES.get(project.templateId);
  const payment = spendNode(state, project, "startup", date);
  if (!payment.ok) return payment;
  reserveResources(state, project, template, date);
  project.status = "PRE_PRODUCTION";
  project.startedAt = date;
  project.earliestPublishDate = addDays(date, template.minimumCalendarDays);
  project.deliveryDate = project.earliestPublishDate;
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function enterLongProjectProduction(sourceState, { projectId, date }) {
  const context = mutateProject(sourceState, projectId, ["PRE_PRODUCTION"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (!allResourcesReserved(state, project)) return { ok: false, code: "RESOURCE_UNAVAILABLE", message: "关键资源尚未预约，不能进入制作" };
  const payment = spendNode(state, project, "production", date);
  if (!payment.ok) return payment;
  project.status = "PRODUCTION";
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function applyLongProjectWork(state, projectId, date) {
  const project = state.projects.find((item) => item.id === projectId && item.type === "LONG_TERM");
  if (!project || project.status !== "PRODUCTION") throw new Error("REQUIREMENT_UNMET");
  project.workCompleted = Math.min(project.workRequired, project.workCompleted + 1);
  project.lastActionAt = date;
  return project;
}

export function processLongProjectDate(sourceState, { projectId, date }) {
  const context = mutateProject(sourceState, projectId, ["PRODUCTION"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (project.workCompleted < project.workRequired) return { ok: false, code: "REQUIREMENT_UNMET", message: "玩家工作量尚未完成；等待时间不能替代排期工作" };
  if (compareIso(date, project.earliestPublishDate) < 0) return { ok: false, code: "TOO_EARLY", message: `最短日历时间尚未满足，需等待至 ${project.earliestPublishDate}` };
  if (!allResourcesReserved(state, project)) return { ok: false, code: "RESOURCE_UNAVAILABLE", message: "关键资源预约不完整" };
  for (const id of project.reservedResourceIds) {
    const reservation = state.resourceReservations.find((item) => item.id === id);
    reservation.status = "FULFILLED";
  }
  for (const request of state.resourceRequests || []) {
    if (request.projectId === project.id && ["PENDING", "APPROVED", "DOWNSCALED", "QUEUED"].includes(request.status)) request.status = "CANCELLED";
  }
  project.status = "QUALITY_CHECK";
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function passLongProjectQuality(sourceState, { projectId, date }) {
  const context = mutateProject(sourceState, projectId, ["QUALITY_CHECK"]);
  if (context.error) return context.error;
  const { state, project } = context;
  const payment = spendNode(state, project, "acceptance", date);
  if (!payment.ok) return payment;
  project.qualityCheck = { status: "PASSED", checkedAt: date };
  project.status = "SCHEDULED";
  project.scheduledPublishDate = date;
  project.deliveryDate = date;
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function publishLongProject(sourceState, { projectId, date }) {
  const context = mutateProject(sourceState, projectId, ["SCHEDULED"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (compareIso(date, project.scheduledPublishDate) < 0) return { ok: false, code: "TOO_EARLY", message: `项目已排期至 ${project.scheduledPublishDate}` };
  if (project.qualityCheck.status !== "PASSED" || project.paymentPlan.paidNodes.length !== 3) return { ok: false, code: "REQUIREMENT_UNMET", message: "质检或付款节点尚未完成" };
  const template = TEMPLATES.get(project.templateId);
  const assetId = `asset_${project.id}`;
  const asset = { id: assetId, type: template.assetType, origin: project.id, ownerParty: project.ownerParty, characterId: state.character.id, projectId: project.id, createdAt: date };
  state.assets.push(asset);
  state.character.assetIds.push(assetId);
  state.licenses.push({ assetId, licenseeParty: "PLAYER", allowedUses: ["STREAM", "VIDEO"], effectiveFrom: date, effectiveTo: null, survivesTermination: project.ownerParty === "PLAYER" });
  project.completedAssetIds.push(assetId);
  project.status = "PUBLISHED";
  project.publishedAt = date;
  project.lastActionAt = date;
  if (project.projectType === "NEW_OUTFIT") {
    const before = Number(state.character.visualProductionBonus || 0);
    state.character.visualProductionBonus = Math.min(template.effect.visualProductionBonusCap, before + template.effect.visualProductionBonus);
    state.character.outfitRevealWindows = Number(state.character.outfitRevealWindows || 0) + template.effect.revealWindows;
    state.character.merchMaterialAssetIds.push(assetId);
    project.appliedEffect = { visualProductionBonusBefore: before, visualProductionBonusAfter: state.character.visualProductionBonus, globalSubscriberMultiplier: 1, revealWindowsGranted: template.effect.revealWindows };
  } else {
    state.history.portfolioWorks.push({ id: `portfolio_${project.id}`, projectId: project.id, assetId, kind: template.effect.portfolioKind, publishedAt: date, longTail: template.effect.longTail, evaluation: "PENDING" });
    project.appliedEffect = { portfolioRecordCreated: true, longTail: template.effect.longTail, guaranteedProfit: false };
  }
  state.snapshotVersion += 1;
  return { ok: true, state, project, asset };
}

export function advanceLongProjectTail(sourceState, { projectId, date }) {
  const context = mutateProject(sourceState, projectId, ["PUBLISHED"]);
  if (context.error) return context.error;
  const { state, project } = context;
  project.status = "LONG_TAIL";
  project.longTailStartedAt = date;
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function archiveLongProject(sourceState, { projectId, date }) {
  const context = mutateProject(sourceState, projectId, ["PUBLISHED", "LONG_TAIL"]);
  if (context.error) return context.error;
  const { state, project } = context;
  project.status = "ARCHIVED";
  project.archivedAt = date;
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function pauseLongProject(sourceState, { projectId, date }) {
  const context = mutateProject(sourceState, projectId, [...PAUSABLE_STATES]);
  if (context.error) return context.error;
  const { state, project } = context;
  project.pausedFromStatus = project.status;
  project.status = "PAUSED";
  project.pausedAt = date;
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function resumeLongProject(sourceState, { projectId, date }) {
  const context = mutateProject(sourceState, projectId, ["PAUSED"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (!PAUSABLE_STATES.has(project.pausedFromStatus)) return { ok: false, code: "INVALID_SAVE", message: "暂停项目缺少可恢复阶段" };
  project.status = project.pausedFromStatus;
  project.pausedFromStatus = null;
  project.resumedAt = date;
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function cancelLongProject(sourceState, { projectId, date, reason = "PLAYER_CANCELLED" }) {
  const allowed = [...PAUSABLE_STATES, "PAUSED"];
  const context = mutateProject(sourceState, projectId, allowed);
  if (context.error) return context.error;
  const { state, project } = context;
  for (const id of project.reservedResourceIds) {
    const reservation = state.resourceReservations.find((item) => item.id === id);
    if (reservation && reservation.status === "RESERVED") reservation.status = "CANCELLED";
  }
  project.status = "CANCELLED";
  project.cancelledAt = date;
  project.cancellationTreatment = { reason, confirmedCostJpy: project.spentCostJpy, refundedJpy: "0", resourceReservationsReleased: project.reservedResourceIds.length };
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function longProjectTemplate(templateId) {
  return TEMPLATES.get(templateId) || null;
}
