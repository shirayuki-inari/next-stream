import { NPC_PROFILES, NPC_SIZE_TIERS } from "../../rules/npc_profiles.js";
import { BALANCE } from "../../rules/balance_standard_0_1.js";

const SKILLS = ["expression", "specialty", "performance", "production", "planning", "collaboration"];
const TIERS = ["NEWCOMER", "GROWING", "MATURE"];
const TOPICS = ["合作挑战", "短篇企划", "翻唱接力", "创作幕后", "耐久挑战", "双语交流"];
const FESTIVALS = ["无公共节庆", "创作者周", "游戏接力祭", "音乐舞台月"];
const WORLD_EVENT_TITLES = ["平台创作接力", "公开音乐周", "独立游戏节", "双语创作者交流月"];
const DIRECTIONS = ["game", "chat", "music", "creative"];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function stableUnit(...parts) {
  const text = parts.join("/");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function stableInteger(minimum, maximum, ...parts) {
  return minimum + Math.floor(stableUnit(...parts) * (maximum - minimum + 1));
}

function isoAddDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function worldEventsForWeek(seed, weekIndex) {
  const events = [];
  for (let startWeek = Math.max(1, weekIndex - 4); startWeek <= weekIndex; startWeek += 1) {
    if (startWeek !== 1 && stableUnit(seed, startWeek, "world-event-start") < 0.58) continue;
    const durationWeeks = stableInteger(1, 2, seed, startWeek, "world-event-duration");
    const endWeek = startWeek + durationWeeks - 1;
    const weeksAfterEnd = Math.max(0, weekIndex - endWeek);
    const heat = Math.max(0, 100 - weeksAfterEnd * 25);
    if (!heat) continue;
    events.push({
      id: `world_event_${startWeek}`,
      title: WORLD_EVENT_TITLES[stableInteger(0, WORLD_EVENT_TITLES.length - 1, seed, startWeek, "world-event-title")],
      startDate: isoAddDays(BALANCE.calendar.startDate, (startWeek - 1) * 7),
      endDate: isoAddDays(BALANCE.calendar.startDate, endWeek * 7 - 1),
      startWeek,
      endWeek,
      heat,
      phase: weekIndex <= endWeek ? "ACTIVE" : "COOLING",
    });
  }
  return events;
}

function tierForProfile(profile, index) {
  const routeIndex = NPC_PROFILES.filter((item, candidateIndex) => candidateIndex < index && item.affiliationId === profile.affiliationId).length;
  return TIERS[routeIndex % TIERS.length];
}

function contentSynergy(playerDirection, npcDirection) {
  if (playerDirection === npcDirection) return 82;
  if (playerDirection === "creative" || npcDirection === "creative") return 70;
  if ([playerDirection, npcDirection].includes("chat")) return 64;
  return 58;
}

export function createNpcRoster(seed, playerDirection = "creative") {
  return NPC_PROFILES.map((profile, index) => {
    const sizeTier = tierForProfile(profile, index);
    const tier = NPC_SIZE_TIERS[sizeTier];
    const abilities = Object.fromEntries(SKILLS.map((skill) => [skill, stableInteger(36, 82, seed, profile.id, skill)]));
    const subscribers = tier.minimum + stableInteger(0, tier.span, seed, profile.id, "subscribers");
    return {
      ...profile,
      sizeTier,
      abilities,
      channelSize: subscribers,
      availableSlots: [],
      healthLoad: stableInteger(22, 72, seed, profile.id, "health"),
      currentProject: {
        id: `${profile.id}_project_1`,
        title: profile.careerGoal,
        direction: profile.direction,
        projectValue: stableInteger(48, 88, seed, profile.id, "project"),
        status: "ACTIVE",
      },
      relationship: {
        familiarity: stableInteger(38, 66, seed, profile.id, "familiarity"),
        workTrust: stableInteger(48, 78, seed, profile.id, "work_trust"),
        contentSynergy: clamp(contentSynergy(playerDirection, profile.direction) + stableInteger(-5, 5, seed, profile.id, "synergy"), 0, 100),
      },
    };
  });
}

export function generateWorldWeek(seed, weekIndex, npcs) {
  const occupied = new Set([5, 9, 12, 13]);
  const npcSchedules = npcs.map((npc) => {
    const availableSlots = Array.from({ length: 14 }, (_, slotIndex) => slotIndex)
      .filter((slotIndex) => !occupied.has(slotIndex))
      .sort((left, right) => stableUnit(seed, weekIndex, npc.id, left) - stableUnit(seed, weekIndex, npc.id, right) || left - right)
      .slice(0, 4);
    return { npcId: npc.id, availableSlots: availableSlots.sort((a, b) => a - b) };
  });
  return {
    id: `world_week_${weekIndex}`,
    weekIndex,
    startDate: isoAddDays(BALANCE.calendar.startDate, (weekIndex - 1) * 7),
    endDate: isoAddDays(BALANCE.calendar.startDate, weekIndex * 7 - 1),
    trendingTopic: TOPICS[stableInteger(0, TOPICS.length - 1, seed, weekIndex, "topic")],
    publicFestival: FESTIVALS[stableInteger(0, FESTIVALS.length - 1, seed, weekIndex, "festival")],
    majorEvent: stableUnit(seed, weekIndex, "major-event") > 0.68 ? "平台主题活动开放申请" : "无重大公共活动",
    debutWindow: stableUnit(seed, weekIndex, "debut") > 0.56 ? "本周末新出道较密集" : "常规出道密度",
    merchDensity: stableInteger(32, 88, seed, weekIndex, "merch-density"),
    supplyResources: stableInteger(35, 90, seed, weekIndex, "supply"),
    worldEvents: worldEventsForWeek(seed, weekIndex),
    npcSchedules,
    npcUpdates: [],
    generatedFromSeed: seed,
  };
}

function applyNpcWeeklyUpdates(state, worldWeek) {
  for (const npc of state.npcs) {
    const draw = stableUnit(state.seed, worldWeek.weekIndex, npc.id, "autonomy");
    npc.healthLoad = clamp(npc.healthLoad + stableInteger(-5, 6, state.seed, worldWeek.weekIndex, npc.id, "health-delta"), 0, 100);
    npc.activityStatus = npc.healthLoad >= 82 ? "PAUSED" : "ACTIVE";
    let update = npc.activityStatus === "PAUSED" ? { type: "PAUSED", explanation: "健康负荷达到可见阈值，本周暂停公开合作。" } : null;
    if (draw > 0.94 && npc.activityStatus === "ACTIVE") {
      const previousDirection = npc.direction;
      npc.direction = DIRECTIONS[(DIRECTIONS.indexOf(npc.direction) + 1) % DIRECTIONS.length];
      npc.currentProject.direction = npc.direction;
      update = { type: "DIRECTION_CHANGED", previousDirection, nextDirection: npc.direction, explanation: "NPC 根据既有项目表现调整了公开方向。" };
    } else if (draw > 0.86 && npc.activityStatus === "ACTIVE") {
      npc.currentProject.status = "COMPLETED";
      update = { type: "PROJECT_COMPLETED", projectId: npc.currentProject.id, explanation: "NPC 项目达到完成条件并退出后续资源申请。" };
    }
    if (update) worldWeek.npcUpdates.push({ npcId: npc.id, ...update });
  }
  const inviter = state.npcs[stableInteger(0, state.npcs.length - 1, state.seed, worldWeek.weekIndex, "incoming-inviter")];
  if (stableUnit(state.seed, worldWeek.weekIndex, "incoming-invite") > 0.55 && inviter.activityStatus === "ACTIVE" && inviter.currentProject.status === "ACTIVE") {
    const schedule = worldWeek.npcSchedules.find((item) => item.npcId === inviter.id)?.availableSlots || [];
    if (schedule.length) {
      const invitation = { id: `npc_invitation_w${worldWeek.weekIndex}_${inviter.id}`, npcId: inviter.id, weekIndex: worldWeek.weekIndex, slotIndex: schedule[0], status: "OPEN", projectTitle: inviter.currentProject.title, expiresAfterWeek: worldWeek.weekIndex, response: `${inviter.name} 邀请你参与「${inviter.currentProject.title}」的合作直播。` };
      state.npcInvitations.push(invitation);
      worldWeek.incomingInvitationId = invitation.id;
    }
  }
}

export function ensureWorldWeek(state, weekIndex = state.weekIndex) {
  state.worldWeeks ??= [];
  state.npcs ??= createNpcRoster(state.seed, state.performer.primaryDirection);
  let worldWeek = state.worldWeeks.find((item) => item.weekIndex === weekIndex);
  if (!worldWeek) {
    worldWeek = generateWorldWeek(state.seed, weekIndex, state.npcs);
    state.worldWeeks.push(worldWeek);
    state.npcInvitations ??= [];
    applyNpcWeeklyUpdates(state, worldWeek);
  }
  for (const npc of state.npcs) npc.availableSlots = [...(worldWeek.npcSchedules.find((item) => item.npcId === npc.id)?.availableSlots || [])];
  return worldWeek;
}

export function respondToNpcInvitation(sourceState, { invitationId, accept }) {
  if (sourceState.phase !== "PLANNING") return failure("INVALID_PHASE", "只能在排期阶段回应 NPC 邀请");
  const state = structuredClone(sourceState);
  const invitation = state.npcInvitations?.find((item) => item.id === invitationId);
  if (!invitation || invitation.status !== "OPEN" || invitation.weekIndex !== state.weekIndex) return failure("INVITATION_NOT_OPEN", "邀请不存在、已回应或已经过期");
  if (!accept) {
    invitation.status = "DECLINED";
    invitation.responseResult = "已礼貌婉拒；熟悉度不会因此自动下降。";
    state.snapshotVersion += 1;
    return { ok: true, state, invitation };
  }
  if (state.plan[invitation.slotIndex]?.actionId || state.collaborationReservations.some((item) => item.weekIndex === state.weekIndex && item.slotIndex === invitation.slotIndex && item.status === "CONFIRMED")) return failure("SLOT_CONFLICT", "邀请档期已经与其他安排冲突");
  invitation.status = "ACCEPTED";
  invitation.responseResult = "已接受；双方档期已锁定，仍需排入本周计划。";
  const reservation = { id: `collab_${invitation.id}`, invitationId: invitation.id, npcId: invitation.npcId, weekIndex: invitation.weekIndex, slotIndex: invitation.slotIndex, status: "CONFIRMED", initiatedBy: "NPC" };
  state.collaborationReservations.push(reservation);
  state.snapshotVersion += 1;
  return { ok: true, state, invitation, reservation };
}

export function invitationScore(state, npcId) {
  const npc = state.npcs?.find((item) => item.id === npcId);
  if (!npc) return null;
  const relation = state.relationships?.find((item) => item.subjectA === state.performer.id && item.subjectB === npc.id) || npc.relationship;
  const contentFit = relation.contentSynergy;
  const workTrust = relation.workTrust;
  const audienceDifference = Math.abs(Math.log10(Math.max(1, npc.channelSize)) - Math.log10(Math.max(1, state.channel.subscribers || 1)));
  const audienceContribution = clamp(14 - audienceDifference * 4, 0, 14);
  const mutualProjectValue = clamp(npc.currentProject.projectValue * 0.78 + audienceContribution + (npc.currentProject.direction === state.performer.primaryDirection ? 8 : 0), 0, 100);
  const preparation = clamp(Math.round(state.performer.abilities.planning * 0.7 + state.performer.abilities.collaboration * 0.2 + Number(state.progression.preparationBank || 0) * 5), 0, 100);
  const total = Math.round((0.35 * contentFit + 0.25 * workTrust + 0.20 * mutualProjectValue + 0.20 * preparation) * 100) / 100;
  return { contentFit, workTrust, mutualProjectValue: Math.round(mutualProjectValue * 100) / 100, preparation, total, formulaVersion: "COLLAB_INVITATION_1_0" };
}

function failure(code, message, details = {}) {
  return { ok: false, code, message, details };
}

export function submitCollaborationInvitation(sourceState, { npcId, slotIndex }) {
  if (sourceState.phase !== "PLANNING") return failure("INVALID_PHASE", "只能在排期阶段提交合作邀请");
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 13) return failure("INVALID_PLAN", "邀请时段无效");
  const state = structuredClone(sourceState);
  ensureWorldWeek(state);
  const npc = state.npcs.find((item) => item.id === npcId);
  if (!npc) return failure("NPC_NOT_FOUND", "合作对象不存在");
  const conflictingReservation = state.collaborationReservations?.find((item) => item.weekIndex === state.weekIndex && item.slotIndex === slotIndex && item.status === "CONFIRMED");
  if (conflictingReservation || state.plan[slotIndex]?.actionId || !npc.availableSlots.includes(slotIndex)) {
    return failure("SLOT_CONFLICT", "该时段与玩家或合作对象的既有安排冲突", { npcId, slotIndex });
  }
  const score = invitationScore(state, npcId);
  const invitationId = `invitation_w${state.weekIndex}_${npcId}_s${slotIndex}`;
  if (state.collaborationInvitations?.some((item) => item.id === invitationId)) return failure("SLOT_CONFLICT", "同一对象与时段已有邀请记录", { npcId, slotIndex });
  const accepted = score.total >= 55;
  const invitation = {
    id: invitationId,
    npcId,
    weekIndex: state.weekIndex,
    slotIndex,
    status: accepted ? "ACCEPTED" : "DECLINED",
    score,
    threshold: 55,
    response: accepted ? `${npc.name} 接受了邀请，档期已为双方保留。` : `${npc.name} 暂未接受；可先提升准备度、工作信任或内容契合。`,
  };
  state.collaborationInvitations.push(invitation);
  let reservation = null;
  if (accepted) {
    reservation = { id: `collab_${invitationId}`, invitationId, npcId, weekIndex: state.weekIndex, slotIndex, status: "CONFIRMED" };
    state.collaborationReservations.push(reservation);
  }
  state.snapshotVersion += 1;
  return { ok: true, state, invitation, reservation };
}

export function collaborationExposureCoefficient(state, npcId, date) {
  const dateValue = Date.parse(`${date}T00:00:00Z`);
  const recentCount = (state.collaborationHistory || []).filter((item) => item.npcId === npcId && item.date < date && dateValue - Date.parse(`${item.date}T00:00:00Z`) <= 28 * 86400000).length;
  return [1, 0.6, 0.3][recentCount] ?? 0.2;
}

export function completeCollaboration(state, reservationId, { date, contentId, quality }) {
  const reservation = state.collaborationReservations.find((item) => item.id === reservationId);
  if (!reservation || reservation.status !== "CONFIRMED") return failure("COLLAB_RESERVATION_INVALID", "联动预约不存在或已使用");
  const npc = state.npcs.find((item) => item.id === reservation.npcId);
  const relation = state.relationships.find((item) => item.subjectA === state.performer.id && item.subjectB === npc.id);
  const exposureCoefficient = collaborationExposureCoefficient(state, npc.id, date);
  reservation.status = "COMPLETED";
  reservation.contentId = contentId;
  relation.familiarity = clamp(relation.familiarity + 4, 0, 100);
  relation.workTrust = clamp(relation.workTrust + (quality >= 55 ? 3 : 1), 0, 100);
  relation.contentSynergy = clamp(relation.contentSynergy + (quality >= 60 ? 2 : 1), 0, 100);
  state.collaborationHistory.push({ id: `collab_history_${contentId}`, reservationId, npcId: npc.id, date, contentId, exposureCoefficient });
  return { ok: true, exposureCoefficient, npc, relation };
}
