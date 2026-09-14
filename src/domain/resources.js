import { AGENCIES } from "../../rules/agency_profiles.js";
import { deterministicRandom } from "./random.js";

const SHARED_TYPES = new Set(["MANAGER_ASSIST", "RECORDING_SLOT", "THREE_D_SLOT", "PROJECT_COORDINATION", "PROMOTION_SLOT"]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function compareIso(a, b) {
  return String(a).localeCompare(String(b));
}

export function isAgencySharedResource(resourceType) {
  return SHARED_TYPES.has(resourceType);
}

function projectFit(agency, project) {
  const preferred = agency.routeId === "homolive"
    ? new Set(["NEW_OUTFIT", "ORIGINAL_SONG", "ANNIVERSARY_3D"])
    : new Set(["COVER_RECORDING", "ORIGINAL_SONG"]);
  return preferred.has(project.projectType) ? 90 : 65;
}

function previousMissCompensation(state, agencyId, resourceType) {
  const misses = (state.resourceRequests || []).filter((request) => request.agencyId === agencyId && request.resourceType === resourceType && ["QUEUED", "DOWNSCALED", "REJECTED"].includes(request.status)).length;
  return Math.min(10, misses * 5);
}

export function agencyResourceRequestScore(state, project, agencyId) {
  const agency = AGENCIES[agencyId];
  if (!agency) throw new Error("INVALID_AGENCY");
  const preparation = clamp(Number(state.performer.abilities.planning || 0) + Math.min(20, Number(project.workCompleted || 0) * 5), 0, 100);
  const fit = projectFit(agency, project);
  const workReputation = clamp(Number(state.performer.workReputation || 0), 0, 100);
  const projectValue = clamp(40 + Math.floor(Number(project.fixedBudgetJpy || 0) / 10000), 0, 100);
  const compensation = previousMissCompensation(state, agencyId, project.pendingResourceType || "");
  const base = 0.35 * preparation + 0.25 * fit + 0.20 * workReputation + 0.20 * projectValue;
  return { preparation, fit, workReputation, projectValue, compensation, total: round2(clamp(base + compensation, 0, 100)) };
}

async function ensureResourceRound(state, agencyId, resourceType, weekIndex) {
  const id = `resource_round_${agencyId}_${weekIndex}_${resourceType}`;
  const existing = state.agencyResourceRounds.find((round) => round.id === id);
  if (existing) return existing;
  const agency = AGENCIES[agencyId];
  const capacity = agency?.weeklyResourceCapacity?.[resourceType];
  if (!Number.isInteger(capacity) || capacity < 0) throw new Error("RESOURCE_UNAVAILABLE");
  const backgroundRequests = [];
  const npcAffiliation = agencyId === "agency_homolive" ? "homolive" : "2434";
  const agencyNpcs = (state.npcs || []).filter((npc) => npc.affiliationId === npcAffiliation && npc.activityStatus !== "PAUSED" && npc.currentProject?.status === "ACTIVE");
  for (let index = 0; index < 3; index += 1) {
    const draw = await deterministicRandom(state.seed, weekIndex, "agency_resource_candidates", `${agencyId}_${resourceType}`, index);
    const npc = agencyNpcs[index % Math.max(agencyNpcs.length, 1)];
    backgroundRequests.push({
      id: `npc_resource_${agencyId}_${weekIndex}_${resourceType}_${npc?.id || index + 1}`,
      applicantType: npc ? "MAJOR_NPC" : "BACKGROUND_CANDIDATE",
      npcId: npc?.id || null,
      projectId: npc?.currentProject?.id || null,
      projectTitle: npc?.currentProject?.title || "背景市场供需",
      quantity: 1,
      score: round2(clamp((npc?.currentProject?.projectValue || 50) * 0.65 + (npc?.abilities?.planning || 50) * 0.2 + draw * 15, 0, 100)),
      requestOrder: index + 1,
      allocatedQuantity: 0,
    });
  }
  const round = { id, agencyId, resourceType, weekIndex, capacity, status: "OPEN", backgroundRequests, playerRequestIds: [], resolvedAt: null, unusedCapacity: null, sourceType: "DESIGN_VALUE" };
  state.agencyResourceRounds.push(round);
  return round;
}

export async function requestAgencyResource(sourceState, { projectId, resourceType, quantity, desiredDate, weekIndex, date }) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段提交公司资源申请" };
  const agencyId = sourceState.affiliation?.agencyId;
  const agency = AGENCIES[agencyId];
  const project = sourceState.projects?.find((item) => item.id === projectId && item.type === "LONG_TERM");
  const requested = Number(quantity);
  if (!agency || !project || !isAgencySharedResource(resourceType)) return { ok: false, code: "REQUIREMENT_UNMET", message: "当前所属、项目或资源类型不支持公司资源申请" };
  if (!Number.isInteger(requested) || requested <= 0 || !desiredDate || compareIso(desiredDate, date) < 0) return { ok: false, code: "INVALID_COMMAND", message: "资源数量或预约日期无效" };
  const requirement = project.requiredResources.find((item) => item.resourceType === resourceType && item.quantity === requested);
  if (!requirement) return { ok: false, code: "REQUIREMENT_UNMET", message: "该资源不在项目已确认的关键依赖中" };
  if (sourceState.resourceRequests?.some((item) => item.projectId === projectId && item.resourceType === resourceType && !["CANCELLED", "REJECTED"].includes(item.status))) return { ok: false, code: "RESOURCE_ALREADY_REQUESTED", message: "该项目已有同类资源申请，不能重复占用" };
  const state = structuredClone(sourceState);
  const nextProject = state.projects.find((item) => item.id === projectId);
  nextProject.pendingResourceType = resourceType;
  const round = await ensureResourceRound(state, agencyId, resourceType, Number(weekIndex || state.weekIndex));
  delete nextProject.pendingResourceType;
  if (round.status !== "OPEN") return { ok: false, code: "RESOURCE_DEADLINE_PASSED", message: "本周同批资源已经结算，请改报下一周" };
  const score = agencyResourceRequestScore(state, nextProject, agencyId);
  score.compensation = previousMissCompensation(state, agencyId, resourceType);
  score.total = round2(clamp(0.35 * score.preparation + 0.25 * score.fit + 0.20 * score.workReputation + 0.20 * score.projectValue + score.compensation, 0, 100));
  const request = {
    id: `resource_request_${projectId}_${resourceType}_${round.weekIndex}_${state.resourceRequests.length + 1}`,
    agencyId,
    projectId,
    resourceType,
    desiredDate,
    requestedQuantity: requested,
    allocatedQuantity: 0,
    score,
    requestOrder: 100 + round.playerRequestIds.length,
    roundId: round.id,
    status: "PENDING",
    resultExplanation: "与同期 NPC 和背景申请在同一截止点结算，尚未分配。",
    createdAt: date,
  };
  state.resourceRequests.push(request);
  round.playerRequestIds.push(request.id);
  const pending = nextProject.pendingResourceRequirements.find((item) => item.resourceType === resourceType);
  if (pending) Object.assign(pending, { status: "PENDING", requestId: request.id });
  state.snapshotVersion += 1;
  return { ok: true, state, request, round };
}

export function resolveAgencyResourceBatch(sourceState, { roundId, date }) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段结算公司资源批次" };
  const sourceRound = sourceState.agencyResourceRounds?.find((item) => item.id === roundId);
  if (!sourceRound || sourceRound.status !== "OPEN") return { ok: false, code: "REQUIREMENT_UNMET", message: "资源批次不存在或已经结算；不会重复分配" };
  const state = structuredClone(sourceState);
  const round = state.agencyResourceRounds.find((item) => item.id === roundId);
  const playerRequests = round.playerRequestIds.map((id) => state.resourceRequests.find((item) => item.id === id)).filter(Boolean);
  const candidates = [
    ...round.backgroundRequests.map((item) => ({ ...item, scoreValue: item.score })),
    ...playerRequests.map((item) => ({ ...item, applicantType: "PLAYER", quantity: item.requestedQuantity, scoreValue: item.score.total })),
  ].sort((a, b) => b.scoreValue - a.scoreValue || a.requestOrder - b.requestOrder);
  let remaining = round.capacity;
  for (const candidate of candidates) {
    const allocated = Math.min(candidate.quantity, remaining);
    remaining -= allocated;
    const background = round.backgroundRequests.find((item) => item.id === candidate.id);
    if (background) {
      background.allocatedQuantity = allocated;
      continue;
    }
    const request = state.resourceRequests.find((item) => item.id === candidate.id);
    request.allocatedQuantity = allocated;
    if (allocated === request.requestedQuantity) {
      request.status = "APPROVED";
      request.resultExplanation = `评分 ${request.score.total}，同批排序后获批 ${allocated}/${request.requestedQuantity}；预约不会重复计入。`;
    } else if (allocated > 0) {
      request.status = "DOWNSCALED";
      request.resultExplanation = `评分 ${request.score.total}，本周容量不足，仅可提供 ${allocated}/${request.requestedQuantity}；关键依赖未满足，建议延期或另提变更单。`;
    } else {
      request.status = "QUEUED";
      request.nextEligibleWeek = round.weekIndex + 1;
      request.resultExplanation = `评分 ${request.score.total}，本周 ${round.capacity} 个共享名额已由更高分申请使用；建议排队至第 ${request.nextEligibleWeek} 周。`;
    }
    if (allocated > 0) {
      const reservation = { id: `reservation_${request.id}`, providerParty: round.agencyId, resourceType: request.resourceType, date: request.desiredDate, quantity: allocated, projectId: request.projectId, requestId: request.id, status: "RESERVED", includedInBudget: true };
      state.resourceReservations.push(reservation);
      request.reservationId = reservation.id;
      const project = state.projects.find((item) => item.id === request.projectId);
      project.reservedResourceIds.push(reservation.id);
      const pending = project.pendingResourceRequirements.find((item) => item.requestId === request.id);
      if (pending) Object.assign(pending, { status: request.status, allocatedQuantity: allocated, resultExplanation: request.resultExplanation });
    } else {
      const project = state.projects.find((item) => item.id === request.projectId);
      const pending = project.pendingResourceRequirements.find((item) => item.requestId === request.id);
      if (pending) Object.assign(pending, { status: request.status, allocatedQuantity: 0, resultExplanation: request.resultExplanation });
    }
  }
  round.status = "RESOLVED";
  round.resolvedAt = date;
  round.unusedCapacity = remaining;
  state.snapshotVersion += 1;
  return { ok: true, state, round, requests: playerRequests.map((item) => state.resourceRequests.find((request) => request.id === item.id)) };
}
