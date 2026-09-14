import { ACTIONS } from "../../rules/actions.js";
import { BALANCE, RULESET_IDS } from "../../rules/balance_standard_0_1.js";
import { ROUTES } from "../../rules/agency_profiles.js";
import { deterministicRandom } from "./random.js";
import {
  adsEligibility,
  allocateNewViewerBudget,
  createAudienceBudgets,
  ensureAudienceBudgetCycle,
  fanFundingEligibility,
  generateMembershipsForLive,
  generateScForLive,
  fulfillMembershipPromise,
  processDueReceivables,
  processMembershipExpiries,
  processMembershipPromiseDeadlines,
  processPlatformReview,
  recalculateEligibilityWindows,
  recordAdsForContent,
} from "./finance.js";
import { fulfillSponsorship, refreshSponsorOffer } from "./sponsorship.js";
import { applyMerchDesignWork } from "./merch.js";
import { applyLongProjectWork } from "./projects.js";
import { applyAuditionPreparation, applyAuditionTest, processAuditionDeadlines } from "./audition.js";
import { applyTransferPreparation } from "./transfers.js";
import { collaborationExposureCoefficient, completeCollaboration, createNpcRoster, ensureWorldWeek, generateWorldWeek } from "./world.js";
import { ensureWeeklyEvent, resolvePendingEventsWithSafeDefaults } from "./events.js";
import { createTutorialState, generateCareerRetrospective, markTutorialProgressInPlace } from "./career.js";
import { availablePropagationBoost, consumePropagationBoost, processPropagationCommissions } from "./distribution.js";
import { createPreferences } from "./preferences.js";

export const SKILLS = Object.freeze(["expression", "specialty", "performance", "production", "planning", "collaboration"]);
export const SKILL_LABELS = Object.freeze({ expression: "表达与临场", specialty: "游戏／专业", performance: "歌唱与舞台", production: "内容制作", planning: "企划经营", collaboration: "团队协作" });
export const DIRECTIONS = Object.freeze({ game: "游戏／专业", chat: "杂谈", music: "音乐／舞台", creative: "综合创作" });
export const GOALS = Object.freeze({ livelihood: "稳定谋生", creator: "内容创作者", stage: "舞台表演者", community: "社群经营者", brand: "独立品牌", reach: "大众影响力" });

const LANGUAGE_WEIGHTS = { jp: 0.6, en: 0.4 };
const PREFERENCE_WEIGHTS = { game: 0.4, chat: 0.25, music: 0.2, creative: 0.15 };
const SPEND_WEIGHTS = { none: 0.8, light: 0.18, high: 0.02 };
const DEFAULT_LIFE = new Map([[5, false], [9, false], [12, true], [13, true]]);

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function isoAddDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function weekDateRange(weekIndex) {
  const start = isoAddDays(BALANCE.calendar.startDate, (weekIndex - 1) * 7);
  return { start, end: isoAddDays(start, 6) };
}

function stableId(prefix, seed, suffix = "0") {
  const clean = String(seed).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "game";
  return `${prefix}_${clean}_${suffix}`;
}

export function createAudienceSegments() {
  const raw = [];
  for (const [language, languageWeight] of Object.entries(LANGUAGE_WEIGHTS)) {
    for (const [preference, preferenceWeight] of Object.entries(PREFERENCE_WEIGHTS)) {
      for (const [spendTier, spendWeight] of Object.entries(SPEND_WEIGHTS)) {
        const id = `seg_${language}_${preference}_${spendTier}`;
        const exact = BALANCE.audience.totalMarket * languageWeight * preferenceWeight * spendWeight;
        raw.push({ id, language, preference, spendTier, exact, floor: Math.floor(exact) });
      }
    }
  }
  let remainder = BALANCE.audience.totalMarket - raw.reduce((sum, item) => sum + item.floor, 0);
  raw.sort((a, b) => (b.exact - b.floor) - (a.exact - a.floor) || a.id.localeCompare(b.id));
  for (const item of raw) {
    item.marketPopulation = item.floor + (remainder-- > 0 ? 1 : 0);
  }
  return raw.sort((a, b) => a.id.localeCompare(b.id)).map(({ exact, floor, ...item }) => ({
    ...item,
    knownViewers: 0,
    subscribers: 0,
    loyalty: 50,
    personAttachment: 50,
    characterAttachment: 50,
    agencyAttachment: 35,
    dailyReachEstimates: [],
  }));
}

export function createDefaultPlan() {
  return Array.from({ length: 14 }, (_, index) => {
    const isLife = DEFAULT_LIFE.has(index);
    return { index, actionId: isLife ? "LIFE" : null, locked: DEFAULT_LIFE.get(index) ?? false, flexibleLife: isLife && !DEFAULT_LIFE.get(index), pairId: null, targetId: null, targetType: null };
  });
}

export function validateAbilities(abilities) {
  const values = SKILLS.map((skill) => Number(abilities[skill]));
  if (values.some((value) => !Number.isInteger(value) || value < 20 || value > 70)) return false;
  return values.reduce((sum, value) => sum + value, 0) === 300;
}

export function createGame(input) {
  if (!input.performerCode?.trim() || !input.characterName?.trim()) throw new Error("请填写表演者代号与角色名");
  if (!ROUTES[input.routeId]) throw new Error("请选择有效路线");
  if (!validateAbilities(input.abilities)) throw new Error("六项能力总和必须为 300，且每项为 20—70");
  const seed = String(input.seed || "next-stream-001").slice(0, 64);
  const route = ROUTES[input.routeId];
  const performerId = stableId("performer", seed);
  const characterId = stableId("character", seed);
  const channelId = stableId("channel", seed);
  const contractId = route.agencyId ? stableId("contract", seed) : null;
  const npcs = createNpcRoster(seed, DIRECTIONS[input.primaryDirection] ? input.primaryDirection : "creative");
  const firstWorldWeek = generateWorldWeek(seed, 1, npcs);
  for (const npc of npcs) npc.availableSlots = [...(firstWorldWeek.npcSchedules.find((item) => item.npcId === npc.id)?.availableSlots || [])];
  const state = {
    id: stableId("game", seed),
    schemaVersion: 1,
    rulesets: { ...RULESET_IDS },
    seed,
    snapshotVersion: 1,
    weekIndex: 1,
    phase: "PLANNING",
    mode: input.mode === "history" ? "history" : "direct",
    routeId: route.id,
    performer: {
      id: performerId,
      code: input.performerCode.trim().slice(0, 24),
      abilities: { ...input.abilities },
      experience: Object.fromEntries(SKILLS.map((skill) => [skill, 0])),
      primaryLanguage: input.primaryLanguage === "en" ? "en" : "jp",
      primaryDirection: DIRECTIONS[input.primaryDirection] ? input.primaryDirection : "creative",
      careerGoal: GOALS[input.careerGoal] ? input.careerGoal : "creator",
      fatigue: 20,
      stress: 20,
      motivation: 60,
      physicalCondition: 90,
      workReputation: 50,
    },
    character: { id: characterId, performerId, name: input.characterName.trim().slice(0, 24), active: true, assetIds: [stableId("asset", seed, "avatar")], visualProductionBonus: 0, outfitRevealWindows: 0, merchMaterialAssetIds: [] },
    channel: {
      id: channelId,
      characterId,
      platformId: "youtube_reference",
      controller: route.assetOwner,
      subscribers: 0,
      fanFundingStatus: "INELIGIBLE",
      adsStatus: "INELIGIBLE",
      adsFeatureEnabled: false,
      scFeatureEnabled: false,
      membershipFeatureEnabled: false,
      commerceTermsAccepted: false,
      creatorIsAdult: true,
      regionAvailable: true,
      channelStanding: "GOOD",
      validPublicUploads90d: 0,
      validWatchMinutes12m: 0,
      shortsViews90d: 0,
    },
    affiliation: { id: stableId("affiliation", seed), performerId, agencyId: route.agencyId, contractId, effectiveFrom: BALANCE.calendar.startDate, effectiveTo: null },
    contract: contractId ? { id: contractId, version: 1, creatorPlatformShareBps: route.creatorShareBps, termWeeks: 52, noticeWeeks: 4, signed: true, allowsExternalAuditions: true, sourceType: "DESIGN_VALUE" } : null,
    assets: [{ id: stableId("asset", seed, "avatar"), type: "AVATAR", ownerParty: route.assetOwner, characterId }],
    licenses: [{ assetId: stableId("asset", seed, "avatar"), licenseeParty: "PLAYER", allowedUses: ["STREAM", "VIDEO"], effectiveFrom: BALANCE.calendar.startDate, effectiveTo: null, survivesTermination: route.id === "indie" }],
    audienceSegments: createAudienceSegments(),
    audienceBudgets: [],
    cash: { free: "600000", restricted: "0", receivable: "0", payable: "0" },
    liabilities: { deferredCustomerFunds: "0", refundPayable: "0" },
    finance: { scGrossLifetime: "0", scRefundsLifetime: "0", scChannelNet: "0", scCreatorEarned: "0", scCreatorReceived: "0", membershipGrossLifetime: "0", membershipChannelNet: "0", membershipCreatorEarned: "0", membershipCreatorReceived: "0", adsChannelNet: "0", adsCreatorEarned: "0", adsCreatorReceived: "0", sponsorGross: "0", sponsorCreatorEarned: "0", sponsorCreatorReceived: "0", merchOrderGmv: "0", merchFulfilledRevenue: "0", projectProfit: "0", royaltyCreatorEarned: "0", royaltyCreatorReceived: "0" },
    membershipProgram: { promisePolicy: "STANDARD", chargesPaused: false, recentFulfillment: 1 },
    sponsorships: [],
    projects: [],
    resourceReservations: [],
    resourceRequests: [],
    agencyResourceRounds: [],
    auditionApplications: [],
    auditionRounds: [],
    transferCases: [],
    npcs,
    worldWeeks: [firstWorldWeek],
    collaborationInvitations: [],
    collaborationReservations: [],
    collaborationHistory: [],
    npcInvitations: [],
    textEvents: [],
    eventWeeksProcessed: [],
    tutorial: createTutorialState(),
    careerRetrospectives: [],
    propagationCommissions: [],
    propagationEvents: [],
    preferences: createPreferences(),
    relationships: npcs.map((npc) => ({ subjectA: performerId, subjectB: npc.id, ...npc.relationship })),
    affiliationHistory: [],
    contractHistory: [],
    historicalCharacters: [],
    historicalChannels: [],
    plan: createDefaultPlan(),
    metrics: { active28dEstimate: 0, weeklyAverageConcurrent: null, weeklyUniqueEstimate: 0, subscriberDelta: 0, lifetimeWatchMinutes: 0 },
    history: {
      contents: [],
      subscriberChanges: [],
      weeklyReports: [],
      platformTransactions: [],
      membershipBatches: [],
      membershipPromises: [],
      membershipPolicyChanges: [],
      receivables: [],
      refundTransactions: [],
      payableSettlements: [],
      merchRefunds: [],
      merchPostDeliveryRefunds: [],
      royaltyTransactions: [],
      portfolioWorks: [],
      journalEntries: [{
        id: "journal_opening",
        date: BALANCE.calendar.startDate,
        sourceId: "opening_balance",
        lines: [
          { account: "CASH_FREE", debit: "600000", credit: "0" },
          { account: "OPENING_EQUITY", debit: "0", credit: "600000" },
        ],
      }],
    },
    commandRecords: [],
    weekRun: null,
    progression: { hasDebuted: false, preparationBank: 0 },
    createdAt: BALANCE.calendar.startDate,
  };
  ensureWeeklyEvent(state);
  return state;
}

export function migrateGame(sourceState) {
  if (!sourceState) return null;
  const state = structuredClone(sourceState);
  state.channel.membershipFeatureEnabled ??= false;
  state.channel.adsFeatureEnabled ??= false;
  state.channel.commerceTermsAccepted ??= false;
  state.channel.creatorIsAdult ??= true;
  state.channel.regionAvailable ??= true;
  state.channel.channelStanding ??= "GOOD";
  state.liabilities ??= {};
  state.liabilities.deferredCustomerFunds ??= "0";
  state.liabilities.refundPayable ??= "0";
  state.sponsorships ??= [];
  state.projects ??= [];
  for (const project of state.projects) {
    if (project.type !== "MERCH") continue;
    const legacyMerchTemplate = BALANCE.merch.acrylicStand;
    project.refundPayableJpy ??= "0";
    project.templateId ??= legacyMerchTemplate.id;
    project.productKind ??= "PHYSICAL";
    project.salesMode ??= "PRESALE";
    project.fixedDesignSampleCostJpy ??= String(legacyMerchTemplate.fixedDesignSampleCostJpy);
    project.initialStockQuantity ??= 0;
    project.reservedInventoryQuantity ??= 0;
    project.timing ??= { samplingDays: legacyMerchTemplate.samplingDays, salesDays: legacyMerchTemplate.salesDays, productionDays: legacyMerchTemplate.productionDays, fulfillmentDays: legacyMerchTemplate.fulfillmentDays, afterSalesDays: legacyMerchTemplate.afterSalesDays };
    project.fundingModel ??= "SELF_RUN";
    project.ownerParty ??= "PLAYER";
    project.fundingParty ??= "PLAYER";
    project.storeController ??= "PLAYER";
    project.fulfillmentParty ??= "PLAYER";
    project.royaltyBps ??= 0;
    project.royaltySurvivesExit ??= false;
    project.royaltyJpy ??= "0";
    project.postDeliveryRefundJpy ??= "0";
    project.refundedOrders ??= 0;
    project.restockedOrders ??= 0;
    project.contractSnapshot ??= null;
    project.companyLedger ??= null;
  }
  state.resourceReservations ??= [];
  state.resourceRequests ??= [];
  state.agencyResourceRounds ??= [];
  state.auditionApplications ??= [];
  state.auditionRounds ??= [];
  state.transferCases ??= [];
  state.npcs ??= createNpcRoster(state.seed, state.performer.primaryDirection);
  state.worldWeeks ??= [];
  state.collaborationInvitations ??= [];
  state.collaborationReservations ??= [];
  state.collaborationHistory ??= [];
  state.npcInvitations ??= [];
  state.textEvents ??= [];
  state.eventWeeksProcessed ??= [];
  state.tutorial ??= createTutorialState();
  state.careerRetrospectives ??= [];
  state.careerEnding ??= null;
  state.propagationCommissions ??= [];
  state.propagationEvents ??= [];
  state.preferences ??= createPreferences();
  state.relationships ??= [];
  for (const npc of state.npcs) {
    if (!state.relationships.some((item) => item.subjectA === state.performer.id && item.subjectB === npc.id)) state.relationships.push({ subjectA: state.performer.id, subjectB: npc.id, ...npc.relationship });
  }
  ensureWorldWeek(state);
  ensureWeeklyEvent(state);
  state.affiliationHistory ??= [];
  state.contractHistory ??= [];
  state.historicalCharacters ??= [];
  state.historicalChannels ??= [];
  if (state.contract) state.contract.allowsExternalAuditions ??= true;
  state.character.visualProductionBonus ??= 0;
  state.character.outfitRevealWindows ??= 0;
  state.character.merchMaterialAssetIds ??= [];
  state.membershipProgram ??= { promisePolicy: "STANDARD", chargesPaused: false, recentFulfillment: 1 };
  state.membershipProgram.promisePolicy ??= "STANDARD";
  state.membershipProgram.chargesPaused ??= false;
  state.membershipProgram.recentFulfillment ??= 1;
  state.plan = (state.plan || createDefaultPlan()).map((slot) => ({ ...slot, targetId: slot.targetId || null, targetType: slot.targetType || (slot.targetId && state.sponsorships.some((deal) => deal.id === slot.targetId) ? "SPONSOR" : null) }));
  state.history.platformTransactions ??= [];
  state.history.membershipBatches ??= [];
  state.history.membershipPromises ??= [];
  state.history.membershipPolicyChanges ??= [];
  state.history.receivables ??= [];
  state.history.refundTransactions ??= [];
  state.history.payableSettlements ??= [];
  state.history.merchRefunds ??= [];
  state.history.merchPostDeliveryRefunds ??= [];
  state.history.royaltyTransactions ??= [];
  state.history.portfolioWorks ??= [];
  state.commandRecords ??= [];
  state.weekRun ??= null;
  const financeDefaults = { membershipGrossLifetime: "0", membershipChannelNet: "0", membershipCreatorEarned: "0", membershipCreatorReceived: "0", adsChannelNet: "0", adsCreatorEarned: "0", adsCreatorReceived: "0", sponsorGross: "0", sponsorCreatorEarned: "0", sponsorCreatorReceived: "0", merchOrderGmv: "0", merchFulfilledRevenue: "0", projectProfit: "0", royaltyCreatorEarned: "0", royaltyCreatorReceived: "0", longTermProjectExpense: "0" };
  for (const [key, value] of Object.entries(financeDefaults)) state.finance[key] ??= value;
  state.audienceBudgets ??= createAudienceBudgets(state.audienceSegments, state.performer.id);
  if (!state.audienceBudgets.length) state.audienceBudgets = createAudienceBudgets(state.audienceSegments, state.performer.id);
  return state;
}

export function updatePlan(state, slotIndex, actionId, { confirmFlexibleLife = false, targetId = null, targetType = null } = {}) {
  if (state.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段修改排期" };
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 13 || !ACTIONS[actionId]) return { ok: false, code: "INVALID_PLAN", message: "活动或格号无效" };
  const target = state.plan[slotIndex];
  if (target.locked) return { ok: false, code: "INVALID_PLAN", message: "此格为锁定的生活保留时间" };
  if (target.flexibleLife && actionId !== "LIFE" && !confirmFlexibleLife) return { ok: false, code: "LIFE_CONFIRM_REQUIRED", message: "此格原为生活保留时间；转换为工作需要确认" };
  const action = ACTIONS[actionId];
  const deal = targetId ? state.sponsorships?.find((item) => item.id === targetId) : null;
  const promise = targetId ? state.history.membershipPromises?.find((item) => item.id === targetId) : null;
  const project = targetId ? state.projects?.find((item) => item.id === targetId) : null;
  const application = targetId ? state.auditionApplications?.find((item) => item.id === targetId) : null;
  const transfer = targetId ? state.transferCases?.find((item) => item.id === targetId) : null;
  const collaborationReservation = targetId ? state.collaborationReservations?.find((item) => item.id === targetId) : null;
  const targetedProjectWork = actionId === "PROJECT_WORK" && ((project?.type === "MERCH" && project.status === "DESIGNING") || (project?.type === "LONG_TERM" && project.status === "PRODUCTION" && project.workCompleted < project.workRequired));
  const targetedAudition = ["AUDITION_PREP", "AUDITION_TEST"].includes(actionId) && ["INTERVIEW_1", "INTERVIEW_2"].includes(application?.status);
  const targetedTransfer = actionId === "TRANSFER_PREP" && transfer?.status === "ASSET_AND_OBLIGATION_PLAN" && transfer.identityPreparation?.funded && transfer.identityPreparation.completedUnits < transfer.identityPreparation.requiredUnits;
  const targetedCollaboration = actionId === "LIVE_COLLAB" && collaborationReservation?.status === "CONFIRMED" && collaborationReservation.weekIndex === state.weekIndex && collaborationReservation.slotIndex === slotIndex;
  if (action.unavailable && !targetedProjectWork && !targetedAudition && !targetedTransfer && !targetedCollaboration) return { ok: false, code: "REQUIREMENT_UNMET", message: action.unavailable };
  if (targetId) {
    const resolvedType = targetType || (deal ? "SPONSOR" : promise ? "MEMBERSHIP_PROMISE" : application ? "AUDITION_APPLICATION" : collaborationReservation ? "COLLAB_RESERVATION" : project?.type === "LONG_TERM" ? "LONG_TERM_PROJECT" : project ? "MERCH_PROJECT" : null);
    if (resolvedType === "SPONSOR" && (actionId !== "EDIT_VIDEO" || !deal || deal.status !== "ACCEPTED")) return { ok: false, code: "CONTRACT_CONFLICT", message: "商单交付必须绑定有效的已接受合作" };
    if (resolvedType === "MEMBERSHIP_PROMISE" && (actionId !== "BUSINESS_ADMIN" || !promise || !["DUE", "OVERDUE"].includes(promise.status))) return { ok: false, code: "REQUIREMENT_UNMET", message: "会员福利处理必须绑定待兑现或逾期承诺" };
    if (resolvedType === "MERCH_PROJECT" && (actionId !== "PROJECT_WORK" || !project || project.status !== "DESIGNING")) return { ok: false, code: "REQUIREMENT_UNMET", message: "项目制作必须绑定处于设计阶段的商品项目" };
    if (resolvedType === "LONG_TERM_PROJECT" && (actionId !== "PROJECT_WORK" || !project || project.type !== "LONG_TERM" || project.status !== "PRODUCTION" || project.workCompleted >= project.workRequired)) return { ok: false, code: "REQUIREMENT_UNMET", message: "项目制作必须绑定仍有未完成工作量的制作中长期项目" };
    if (resolvedType === "AUDITION_APPLICATION" && (!["AUDITION_PREP", "AUDITION_TEST"].includes(actionId) || !application || !["INTERVIEW_1", "INTERVIEW_2"].includes(application.status))) return { ok: false, code: "REQUIREMENT_UNMET", message: "招募准备或面试必须绑定已进入面试阶段的申请" };
    if (resolvedType === "TRANSFER_CASE" && (actionId !== "TRANSFER_PREP" || !targetedTransfer)) return { ok: false, code: "TRANSFER_REQUIREMENTS_UNMET", message: "新身份准备必须绑定已确认且已筹资的转籍方案" };
    if (resolvedType === "COLLAB_RESERVATION" && !targetedCollaboration) return { ok: false, code: "SLOT_CONFLICT", message: "联动必须排在预约确认的同一时段" };
    if (resolvedType === "COLLAB_RESERVATION" && state.plan.some((slot) => slot.index !== slotIndex && slot.targetType === "COLLAB_RESERVATION" && slot.targetId === targetId)) return { ok: false, code: "SLOT_CONFLICT", message: "这份联动预约已经排入其他时段" };
    if (!resolvedType) return { ok: false, code: "REQUIREMENT_UNMET", message: "排期目标不存在或已失效" };
    targetType = resolvedType;
  }
  const next = structuredClone(state);
  clearPair(next.plan, slotIndex);
  if (action.slots === 2) {
    const partner = slotIndex % 2 === 0 ? slotIndex + 1 : slotIndex - 1;
    if (partner < 0 || partner > 13 || next.plan[partner].locked) return { ok: false, code: "INVALID_PLAN", message: "两格活动必须占据同一天相邻格，且不能覆盖锁定生活格" };
    if (next.plan[partner].flexibleLife && !confirmFlexibleLife) return { ok: false, code: "LIFE_CONFIRM_REQUIRED", message: "相邻格包含生活保留时间；转换为工作需要确认" };
    clearPair(next.plan, partner);
    const pairId = `pair_${next.weekIndex}_${Math.floor(slotIndex / 2)}_${actionId}`;
    for (const index of [slotIndex, partner]) Object.assign(next.plan[index], { actionId, pairId, flexibleLife: false, targetId, targetType });
  } else {
    Object.assign(next.plan[slotIndex], { actionId, pairId: null, flexibleLife: actionId === "LIFE" ? target.flexibleLife : false, targetId, targetType: targetId ? targetType : null });
  }
  const auditionOrder = validateAuditionPlanOrder(next);
  if (!auditionOrder.ok) return auditionOrder;
  const transferOrder = validateTransferPlan(next);
  if (!transferOrder.ok) return transferOrder;
  const validation = validatePlan(next.plan);
  if (!validation.ok) return validation;
  if (!["LIFE", "REST"].includes(actionId)) markTutorialProgressInPlace(next, "SCHEDULE", weekDateRange(next.weekIndex).start);
  next.snapshotVersion += 1;
  return { ok: true, state: next };
}

function validateAuditionPlanOrder(state) {
  for (const application of state.auditionApplications || []) {
    let simulatedStatus = application.status;
    let prep = Number(application.interviewPrepModifier || 0);
    const targeted = state.plan.filter((slot) => slot.targetType === "AUDITION_APPLICATION" && slot.targetId === application.id).sort((a, b) => a.index - b.index);
    for (const slot of targeted) {
      if (!["INTERVIEW_1", "INTERVIEW_2"].includes(simulatedStatus)) return { ok: false, code: "INVALID_PLAN", message: "面试完成后的格不能继续绑定同一申请" };
      if (slot.actionId === "AUDITION_PREP") {
        if (prep >= BALANCE.audition.interviewPrepCap) return { ok: false, code: "INVALID_PLAN", message: "面试准备修正最多 8 点，额外准备格不会被接受" };
        prep = Math.min(BALANCE.audition.interviewPrepCap, prep + BALANCE.audition.interviewPrepPerSlot);
      } else if (slot.actionId === "AUDITION_TEST") simulatedStatus = simulatedStatus === "INTERVIEW_1" ? "INTERVIEW_2" : "FINAL_RESOLVED";
    }
  }
  return { ok: true };
}

function validateTransferPlan(state) {
  for (const transfer of state.transferCases || []) {
    const remaining = Number(transfer.identityPreparation?.requiredUnits || 0) - Number(transfer.identityPreparation?.completedUnits || 0);
    const planned = state.plan.filter((slot) => slot.actionId === "TRANSFER_PREP" && slot.targetType === "TRANSFER_CASE" && slot.targetId === transfer.id).length;
    if (planned > remaining) return { ok: false, code: "INVALID_PLAN", message: "新身份准备格已达到方案所需工作量" };
  }
  return { ok: true };
}

export function removePlanAction(state, slotIndex) {
  if (state.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段修改排期" };
  const target = state.plan[slotIndex];
  if (!target || target.locked) return { ok: false, code: "INVALID_PLAN", message: "锁定的生活格不能移除" };
  const next = structuredClone(state);
  const indexes = next.plan[slotIndex].pairId ? next.plan.filter((slot) => slot.pairId === next.plan[slotIndex].pairId).map((slot) => slot.index) : [slotIndex];
  for (const index of indexes) {
    const wasFlexible = DEFAULT_LIFE.has(index) && !DEFAULT_LIFE.get(index);
    Object.assign(next.plan[index], { actionId: wasFlexible ? "LIFE" : null, pairId: null, flexibleLife: wasFlexible, targetId: null, targetType: null });
  }
  next.snapshotVersion += 1;
  return { ok: true, state: next };
}

function clearPair(plan, slotIndex) {
  const pairId = plan[slotIndex].pairId;
  if (!pairId) return;
  for (const slot of plan) if (slot.pairId === pairId) Object.assign(slot, { actionId: null, pairId: null, targetId: null, targetType: null });
}

export function validatePlan(plan) {
  const working = plan.filter((slot) => slot.actionId && !["LIFE", "REST"].includes(slot.actionId)).length;
  if (working > 12) return { ok: false, code: "INVALID_PLAN", message: "每周最多安排 12 个工作格，至少保留 2 个生活格" };
  for (const slot of plan) {
    const action = slot.actionId ? ACTIONS[slot.actionId] : null;
    if (action?.slots === 2) {
      const pair = plan.filter((item) => item.pairId === slot.pairId);
      if (!slot.pairId || pair.length !== 2 || Math.floor(pair[0].index / 2) !== Math.floor(pair[1].index / 2)) return { ok: false, code: "INVALID_PLAN", message: "两格活动必须在同一天连续安排" };
    }
  }
  return { ok: true };
}

export function relatedAbility(abilities, actionId) {
  if (actionId === "LIVE_GAME") return 0.6 * abilities.specialty + 0.4 * abilities.expression;
  if (actionId === "LIVE_CHAT") return abilities.expression;
  if (actionId === "LIVE_MUSIC") return 0.7 * abilities.performance + 0.3 * abilities.expression;
  if (actionId === "LIVE_COLLAB") return 0.5 * abilities.collaboration + 0.25 * abilities.specialty + 0.25 * abilities.expression;
  return 0.6 * abilities.production + 0.4 * abilities.planning;
}

export function calculateQuality({ related, preparation, match, production, fatigue, stress, physicalCondition, noise = 1, choiceDelta = 0 }) {
  const base = 0.4 * related + 0.25 * preparation + 0.2 * match + 0.15 * production;
  const stateMultiplier = clamp(1 - 0.003 * Math.max(fatigue - 40, 0) - 0.002 * Math.max(stress - 50, 0) - 0.002 * Math.max(70 - physicalCondition, 0), 0.6, 1);
  return { base, stateMultiplier, quality: clamp(base * stateMultiplier * noise + choiceDelta, 0, 100) };
}

export function unionEstimate(known, first, second) {
  if (known === 0) return 0;
  return Number((known * (1 - (1 - first / known) * (1 - second / known))).toFixed(6));
}

export function averageConcurrent(viewers, averageMinutes, streamMinutes) {
  return Math.round((viewers * averageMinutes) / streamMinutes);
}

function contentPreference(actionId) {
  if (actionId === "LIVE_GAME") return "game";
  if (actionId === "LIVE_CHAT") return "chat";
  if (actionId === "LIVE_MUSIC") return "music";
  return "creative";
}

function matchScore(state, actionId, segment) {
  const preference = contentPreference(actionId);
  const directionMatch = state.performer.primaryDirection === preference ? 1 : state.performer.primaryDirection === "creative" ? 0.86 : 0.66;
  const preferenceMatch = segment.preference === preference ? 1.15 : segment.preference === "creative" ? 0.88 : 0.62;
  const languageMatch = segment.language === state.performer.primaryLanguage ? 1 : 0.25;
  return clamp(directionMatch * preferenceMatch * languageMatch, 0.2, 1.2);
}

function compactActiveEstimate(segments) {
  return Math.round(segments.reduce((total, segment) => {
    const daily = segment.dailyReachEstimates.slice(-28);
    if (!daily.length || !segment.knownViewers) return total;
    const coverage = 1 - daily.reduce((product, item) => product * (1 - Math.min(item.unique / segment.knownViewers, 1)), 1);
    const estimate = Math.round(segment.knownViewers * coverage);
    return total + clamp(estimate, Math.max(...daily.map((item) => item.unique)), segment.knownViewers);
  }, 0));
}

function activityMatchValue(state, actionId) {
  const preference = contentPreference(actionId);
  if (state.performer.primaryDirection === preference) return 88;
  if (state.performer.primaryDirection === "creative") return 78;
  return 66;
}

export function previewWeek(state) {
  const activities = state.plan.map((slot) => slot.actionId || "REST");
  const uniqueActions = activities.filter((id, index) => !state.plan[index].pairId || state.plan.findIndex((slot) => slot.pairId === state.plan[index].pairId) === index);
  const fatigueDelta = uniqueActions.reduce((sum, id) => sum + (ACTIONS[id]?.fatigue || 0), 0) - 28;
  const stressDelta = uniqueActions.reduce((sum, id) => sum + (ACTIONS[id]?.stress || 0), 0) - 14;
  const liveCount = uniqueActions.filter((id) => ACTIONS[id]?.kind === "live").length;
  const workSlots = activities.filter((id) => !["REST", "LIFE"].includes(id)).length;
  const projectedFatigue = clamp(state.performer.fatigue + fatigueDelta, 0, 100);
  const projectedStress = clamp(state.performer.stress + stressDelta, 0, 100);
  const baseGrowth = liveCount * (state.progression.hasDebuted ? 18 : ROUTES[state.routeId].launchImpressions > 3000 ? 110 : 35);
  return {
    liveCount,
    workSlots,
    projectedFatigue,
    projectedStress,
    subscriberRange: [Math.max(0, Math.floor(baseGrowth * 0.65)), Math.ceil(baseGrowth * 1.35)],
    risk: projectedFatigue > 75 || projectedStress > 70 ? "high" : projectedFatigue > 58 || projectedStress > 55 ? "medium" : "low",
  };
}

function gainExperience(state, skill, baseExperience, repeatFactor, weeklyXp) {
  if (!skill) return;
  const current = state.performer.abilities[skill];
  const gained = Math.floor(baseExperience * (1 - current / 100) * repeatFactor);
  const accepted = Math.max(0, Math.min(gained, 200 - (weeklyXp[skill] || 0)));
  weeklyXp[skill] = (weeklyXp[skill] || 0) + accepted;
}

export async function settleWeek(sourceState) {
  const planValidation = validatePlan(sourceState.plan);
  if (!planValidation.ok) return planValidation;
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "本周不在可结算的计划阶段" };
  let state = structuredClone(sourceState);
  state = resolvePendingEventsWithSafeDefaults(state);
  if (!state.audienceBudgets?.length) state.audienceBudgets = createAudienceBudgets(state.audienceSegments, state.performer.id);
  const currentWorldWeek = ensureWorldWeek(state);
  state.phase = "RUNNING";
  const route = ROUTES[state.routeId];
  const range = weekDateRange(state.weekIndex);
  const completedPairs = new Set();
  const repeatCounts = {};
  const weeklyXp = Object.fromEntries(SKILLS.map((skill) => [skill, 0]));
  let totalViewMinutes = 0;
  let liveViewMinutes = 0;
  let totalLiveMinutes = 0;
  let weeklyUnique = 0;
  let subscriberDelta = 0;
  let partTimeIncome = 0n;
  let dueReceipts = 0n;
  let weeklyScGross = 0n;
  let weeklyScCreator = 0n;
  let weeklyMembershipGross = 0n;
  let weeklyMembershipCreator = 0n;
  let weeklyMembersJoined = 0;
  let weeklyAdsChannelNet = 0n;
  let weeklyAdsCreator = 0n;
  let weeklySponsorGross = 0n;
  let weeklySponsorCreator = 0n;
  let weeklyMembershipPromisesFulfilled = 0;
  const weekOpeningCash = BigInt(state.cash.free);
  const activityResults = [];
  const contents = [];
  let preparationBank = state.progression.preparationBank || 0;

  for (let slotIndex = 0; slotIndex < 14; slotIndex += 1) {
    const planned = state.plan[slotIndex];
    const actionId = planned.actionId || "REST";
    const action = ACTIONS[actionId];
    if (planned.pairId && completedPairs.has(planned.pairId)) {
      if (slotIndex % 2 === 1) {
        state.performer.fatigue = clamp(state.performer.fatigue - 4, 0, 100);
        state.performer.stress = clamp(state.performer.stress - 2, 0, 100);
      }
      continue;
    }
    if (planned.pairId) completedPairs.add(planned.pairId);
    const occurrence = repeatCounts[actionId] || 0;
    repeatCounts[actionId] = occurrence + 1;
    const repeatFactor = occurrence === 0 ? 1 : occurrence === 1 ? 0.7 : 0.4;
    const date = isoAddDays(range.start, Math.floor(slotIndex / 2));
    if (slotIndex % 2 === 0) {
      ensureAudienceBudgetCycle(state, date);
      dueReceipts += processDueReceivables(state, date);
      processMembershipPromiseDeadlines(state, date);
      await processMembershipExpiries(state, date);
      processPlatformReview(state, date);
      processAuditionDeadlines(state, date);
      processPropagationCommissions(state, date);
    }
    state.performer.fatigue = clamp(state.performer.fatigue + action.fatigue, 0, 100);
    state.performer.stress = clamp(state.performer.stress + action.stress, 0, 100);
    state.performer.motivation = clamp(state.performer.motivation + (action.motivation || 0), 0, 100);

    if (actionId === "PREPARE_CONTENT") preparationBank = Math.min(2, preparationBank + 1);
    if (actionId === "PART_TIME") partTimeIncome += action.income;
    if (actionId === "BUSINESS_ADMIN" && planned.targetId && planned.targetType === "MEMBERSHIP_PROMISE") {
      fulfillMembershipPromise(state, planned.targetId, date);
      weeklyMembershipPromisesFulfilled += 1;
    }
    if (actionId === "PROJECT_WORK" && planned.targetId && planned.targetType === "MERCH_PROJECT") applyMerchDesignWork(state, planned.targetId, date);
    if (actionId === "PROJECT_WORK" && planned.targetId && planned.targetType === "LONG_TERM_PROJECT") applyLongProjectWork(state, planned.targetId, date);
    if (actionId === "AUDITION_PREP" && planned.targetId && planned.targetType === "AUDITION_APPLICATION") applyAuditionPreparation(state, planned.targetId, date);
    if (actionId === "AUDITION_TEST" && planned.targetId && planned.targetType === "AUDITION_APPLICATION") await applyAuditionTest(state, planned.targetId, date);
    if (actionId === "TRANSFER_PREP" && planned.targetId && planned.targetType === "TRANSFER_CASE") applyTransferPreparation(state, planned.targetId, date);
    const xpBase = actionId === "PRACTICE" ? 180 : actionId === "REVIEW" ? 100 : action.kind === "rest" || action.kind === "life" ? 0 : 40;
    gainExperience(state, action.skill, xpBase, repeatFactor, weeklyXp);

    if (["live", "video"].includes(action.kind)) {
      const draw = await deterministicRandom(state.seed, state.weekIndex, "content_quality", `${state.channel.id}_${slotIndex}`, occurrence);
      const noise = 0.94 + draw * 0.12;
      const preparation = 40 + Math.min(40, preparationBank * 20);
      if (preparationBank > 0) preparationBank -= 1;
      const qualityResult = calculateQuality({
        related: relatedAbility(state.performer.abilities, actionId),
        preparation,
        match: activityMatchValue(state, actionId),
        production: 50 + (["LIVE_MUSIC", "MAKE_SHORT", "EDIT_VIDEO"].includes(actionId) ? Math.min(20, Number(state.character.visualProductionBonus || 0)) : 0),
        fatigue: state.performer.fatigue,
        stress: state.performer.stress,
        physicalCondition: state.performer.physicalCondition,
        noise,
      });
      const collabReservation = actionId === "LIVE_COLLAB" && planned.targetType === "COLLAB_RESERVATION" ? state.collaborationReservations.find((item) => item.id === planned.targetId) : null;
      const collabExposure = collabReservation ? collaborationExposureCoefficient(state, collabReservation.npcId, date) : 1;
      const propagationBoost = availablePropagationBoost(state);
      let contentUnique = 0;
      let contentSubscribers = 0;
      let contentWatchMinutes = 0;
      const segmentSnapshots = [];
      for (const segment of state.audienceSegments) {
        const match = matchScore(state, actionId, segment);
        const avgPopulation = BALANCE.audience.totalMarket / 24;
        const pool = BALANCE.audience.baseImpressionPoolPerSegmentSlot * segment.marketPopulation / avgPopulation;
        const playerWeight = (1 + Math.log(1 + compactActiveEstimate([segment])) / 3) * (0.5 + qualityResult.quality / 100) * match;
        const marketSupplyFactor = 0.75 + Number(currentWorldWeek.supplyResources || 50) / 200;
        let impressions = Math.floor(pool * playerWeight / (playerWeight + BALANCE.audience.backgroundRecommendationWeight * marketSupplyFactor) * collabExposure);
        impressions += Math.floor(propagationBoost * segment.marketPopulation / BALANCE.audience.totalMarket);
        if (!state.progression.hasDebuted && action.kind === "live") impressions += Math.floor(route.launchImpressions * segment.marketPopulation / BALANCE.audience.totalMarket);
        const packaging = clamp(45 + state.performer.abilities.planning * 0.35, 0, 100);
        const ctr = clamp(0.025 + 0.05 * packaging / 100, 0.01, 0.1);
        const clicks = Math.floor(impressions * ctr);
        const newViewers = Math.floor(clicks * (1 - segment.knownViewers / segment.marketPopulation));
        const recentActiveRatio = segment.knownViewers ? Math.min(1, compactActiveEstimate([segment]) / segment.knownViewers) : 0;
        const returning = Math.floor(segment.knownViewers * 0.12 * match * 0.9 * (0.2 + 0.8 * recentActiveRatio) * (0.5 + segment.loyalty / 100));
        const unique = Math.min(segment.marketPopulation, Math.round(unionEstimate(Math.max(segment.knownViewers, 1), Math.min(segment.knownViewers, returning), Math.min(segment.knownViewers, Math.floor(clicks * 0.2)))) + newViewers);
        const streamMinutes = action.kind === "live" ? 120 : 12;
        const watchRatio = clamp(0.12 + 0.5 * qualityResult.quality / 100 + 0.15 * match + 0.08 * segment.loyalty / 100, 0.05, 0.85);
        const watchMinutes = Math.round(unique * streamMinutes * watchRatio);
        const convertible = newViewers + returning * (1 - segment.subscribers / Math.max(segment.knownViewers, 1));
        const pSub = clamp(0.01 + 0.06 * qualityResult.quality / 100 + 0.04 * match, 0.005, 0.15) * (action.kind === "video" ? 0.6 : 1);
        const gainedSubs = Math.max(0, Math.min(Math.round(convertible * pSub), unique - Math.min(segment.subscribers, unique)));
        const budget = state.audienceBudgets.find((item) => item.lineageId === segment.id && item.performerId === state.performer.id);
        allocateNewViewerBudget(state, segment, budget, newViewers, date);
        segmentSnapshots.push({ segmentId: segment.id, unique, newViewers, returning, loyalty: segment.loyalty });
        segment.knownViewers = Math.min(segment.marketPopulation, segment.knownViewers + newViewers);
        segment.subscribers = Math.min(segment.knownViewers, segment.subscribers + gainedSubs);
        segment.loyalty = clamp(segment.loyalty + clamp((qualityResult.quality - 55) / 10, -3, 3), 0, 100);
        segment.dailyReachEstimates.push({ date, unique });
        segment.dailyReachEstimates = segment.dailyReachEstimates.slice(-365);
        contentUnique += unique;
        contentSubscribers += gainedSubs;
        contentWatchMinutes += watchMinutes;
      }
      const contentId = `content_w${state.weekIndex}_s${slotIndex}`;
      const content = {
        id: contentId,
        channelId: state.channel.id,
        type: action.kind === "live" ? "LIVE" : actionId === "MAKE_SHORT" ? "SHORT" : "VIDEO",
        actionId,
        publishedAt: date,
        quality: Number(qualityResult.quality.toFixed(2)),
        durationMinutes: action.kind === "live" ? 120 : 12,
        uniqueEstimate: contentUnique,
        watchMinutes: contentWatchMinutes,
        averageConcurrent: action.kind === "live" ? Math.round(contentWatchMinutes / 120) : null,
        subscriberDelta: contentSubscribers,
        visibility: "PUBLIC",
        ageRestricted: false,
        madeForKids: false,
        liveChatEnabled: true,
        usesGivingFundraiser: false,
        licenseTags: ["PLATFORM_PUBLIC_VIEWING", "THIRD_PARTY_MATERIAL_RESTRICTED"],
        reasons: [preparation >= 60 ? "准备充分" : "按基础准备完成", activityMatchValue(state, actionId) >= 80 ? "内容方向匹配" : "正在拓展新方向", qualityResult.stateMultiplier < 0.9 ? "当前状态影响发挥" : "工作状态稳定", ...(["LIVE_MUSIC", "MAKE_SHORT", "EDIT_VIDEO"].includes(actionId) && Number(state.character.visualProductionBonus || 0) > 0 ? [`视觉资产制作项 +${Math.min(20, Number(state.character.visualProductionBonus))}`] : [])],
      };
      if (collabReservation) {
        const completed = completeCollaboration(state, collabReservation.id, { date, contentId, quality: content.quality });
        content.collaboration = { reservationId: collabReservation.id, npcId: completed.npc.id, npcName: completed.npc.name, exposureCoefficient: completed.exposureCoefficient };
        content.reasons.push(`近 4 周同对象曝光系数 ×${completed.exposureCoefficient}`);
      }
      if (propagationBoost > 0) {
        consumePropagationBoost(state, contentId);
        content.propagationBoost = propagationBoost;
        content.reasons.push(`已授权传播委托带来 ${propagationBoost} 次额外推荐机会`);
      }
      if (planned.targetId && (planned.targetType === "SPONSOR" || state.sponsorships.some((deal) => deal.id === planned.targetId))) {
        content.sponsorship = fulfillSponsorship(state, planned.targetId, content);
        weeklySponsorGross += BigInt(content.sponsorship.quoteJpy);
        weeklySponsorCreator += BigInt(content.sponsorship.creatorEarnedJpy);
      }
      if (action.kind === "live") {
        const sc = await generateScForLive(state, content, segmentSnapshots, slotIndex);
        const memberships = await generateMembershipsForLive(state, content, segmentSnapshots, slotIndex);
        content.commerce = { sc, memberships };
        weeklyScGross += BigInt(sc.grossJpy);
        weeklyScCreator += BigInt(sc.creatorEarnedJpy);
        weeklyMembershipGross += BigInt(memberships.grossJpy);
        weeklyMembershipCreator += BigInt(memberships.creatorEarnedJpy);
        weeklyMembersJoined += memberships.joined;
      }
      const ads = recordAdsForContent(state, content);
      content.ads = ads;
      weeklyAdsChannelNet += BigInt(ads.channelNetJpy);
      weeklyAdsCreator += BigInt(ads.creatorEarnedJpy);
      contents.push(content);
      state.history.subscriberChanges.push({ id: `sub_w${state.weekIndex}_s${slotIndex}`, channelId: state.channel.id, date, delta: contentSubscribers, sourceId: contentId });
      weeklyUnique += contentUnique;
      subscriberDelta += contentSubscribers;
      totalViewMinutes += contentWatchMinutes;
      if (action.kind === "live") {
        totalLiveMinutes += 120;
        liveViewMinutes += contentWatchMinutes;
      }
      state.progression.hasDebuted ||= action.kind === "live";
      if (action.kind === "live") markTutorialProgressInPlace(state, "FIRST_LIVE", date);
      if (action.kind === "video") markTutorialProgressInPlace(state, "FIRST_VIDEO", date);
      activityResults.push({ actionId, date, quality: content.quality, unique: contentUnique, subscribers: contentSubscribers });
    }

    if (slotIndex % 2 === 1) {
      state.performer.fatigue = clamp(state.performer.fatigue - 4, 0, 100);
      state.performer.stress = clamp(state.performer.stress - 2, 0, 100);
    }
  }

  for (const skill of SKILLS) {
    state.performer.experience[skill] += weeklyXp[skill];
    const levels = Math.floor(state.performer.experience[skill] / 100);
    if (levels > 0) {
      const applied = Math.min(levels, 100 - state.performer.abilities[skill]);
      state.performer.abilities[skill] += applied;
      state.performer.experience[skill] -= applied * 100;
    }
  }
  const expenses = BigInt(BALANCE.costs.weeklyLivingJpy) + route.weeklyToolCost;
  const closingCash = BigInt(state.cash.free) + partTimeIncome - expenses;
  state.cash.free = String(closingCash < 0n ? 0n : closingCash);
  state.history.journalEntries.push({ id: `journal_w${state.weekIndex}_costs`, date: range.end, sourceId: `weekly_costs_${state.weekIndex}`, lines: [{ account: "LIVING_COST", debit: BALANCE.costs.weeklyLivingJpy, credit: "0" }, ...(route.weeklyToolCost ? [{ account: "OPERATING_COST", debit: String(route.weeklyToolCost), credit: "0" }] : []), { account: "CASH_FREE", debit: "0", credit: String(expenses) }] });
  if (partTimeIncome > 0n) state.history.journalEntries.push({ id: `journal_w${state.weekIndex}_part_time`, date: range.end, sourceId: `part_time_${state.weekIndex}`, lines: [{ account: "CASH_FREE", debit: String(partTimeIncome), credit: "0" }, { account: "OTHER_INCOME", debit: "0", credit: String(partTimeIncome) }] });
  state.channel.subscribers += subscriberDelta;
  state.history.contents.push(...contents);
  processMembershipPromiseDeadlines(state, isoAddDays(range.end, 1));
  recalculateEligibilityWindows(state, range.end);
  refreshSponsorOffer(state, range.end);
  state.progression.preparationBank = preparationBank;
  state.metrics = {
    active28dEstimate: compactActiveEstimate(state.audienceSegments),
    weeklyAverageConcurrent: totalLiveMinutes ? Math.round(liveViewMinutes / totalLiveMinutes) : null,
    weeklyUniqueEstimate: weeklyUnique,
    subscriberDelta,
    lifetimeWatchMinutes: state.metrics.lifetimeWatchMinutes + totalViewMinutes,
  };
  state.performer.physicalCondition = clamp(state.performer.physicalCondition + 2 - (state.performer.fatigue > 70 ? 3 : 0) - (state.performer.fatigue > 85 ? 3 : 0), 0, 100);
  if (["INELIGIBLE", "REJECTED"].includes(state.channel.fanFundingStatus) && fanFundingEligibility(state.channel).eligible) state.channel.fanFundingStatus = "ELIGIBLE_TO_APPLY";
  if (["INELIGIBLE", "REJECTED"].includes(state.channel.adsStatus) && adsEligibility(state.channel).eligible) state.channel.adsStatus = "ELIGIBLE_TO_APPLY";
  const report = {
    weekIndex: state.weekIndex,
    dateStart: range.start,
    dateEnd: range.end,
    subscriberDelta,
    subscribers: state.channel.subscribers,
    active28dEstimate: state.metrics.active28dEstimate,
    averageConcurrent: state.metrics.weeklyAverageConcurrent,
    weeklyUniqueEstimate: weeklyUnique,
    cashChange: String(BigInt(state.cash.free) - weekOpeningCash),
    closingCash: state.cash.free,
    dueReceiptsJpy: String(dueReceipts),
    commerce: {
      scGrossJpy: String(weeklyScGross),
      scCreatorEarnedJpy: String(weeklyScCreator),
      membershipGrossJpy: String(weeklyMembershipGross),
      membershipCreatorEarnedJpy: String(weeklyMembershipCreator),
      membersJoined: weeklyMembersJoined,
      membershipPromisesFulfilled: weeklyMembershipPromisesFulfilled,
      adsChannelNetJpy: String(weeklyAdsChannelNet),
      adsCreatorEarnedJpy: String(weeklyAdsCreator),
      sponsorGrossJpy: String(weeklySponsorGross),
      sponsorCreatorEarnedJpy: String(weeklySponsorCreator),
    },
    activities: activityResults,
    contents,
    state: { fatigue: state.performer.fatigue, stress: state.performer.stress, motivation: state.performer.motivation, physicalCondition: state.performer.physicalCondition },
    xp: weeklyXp,
  };
  state.history.weeklyReports.push(report);
  state.phase = "REPORT";
  state.snapshotVersion += 1;
  return { ok: true, state, report };
}

export function acknowledgeReport(sourceState) {
  if (sourceState.phase !== "REPORT") return { ok: false, code: "INVALID_PHASE", message: "当前没有待确认的周报" };
  const state = structuredClone(sourceState);
  if (state.weekIndex === 104) {
    state.careerRetrospectives ??= [];
    generateCareerRetrospective(state);
    state.phase = "RETROSPECTIVE";
    state.snapshotVersion += 1;
    return { ok: true, state };
  }
  state.weekIndex += 1;
  state.phase = "PLANNING";
  state.plan = createDefaultPlan();
  ensureWorldWeek(state, state.weekIndex);
  ensureWeeklyEvent(state);
  state.metrics.subscriberDelta = 0;
  state.snapshotVersion += 1;
  return { ok: true, state };
}
