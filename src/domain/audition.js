import { AGENCIES } from "../../rules/agency_profiles.js";
import { BALANCE } from "../../rules/balance_standard_0_1.js";
import { deterministicRandom } from "./random.js";

const ACTIVE_STATES = new Set(["DRAFT_APPLICATION", "SUBMITTED", "SCREENING", "INTERVIEW_1", "INTERVIEW_2", "CONDITIONAL_OFFER", "CONTRACT_REVIEW", "PREPARING_DEBUT"]);
const TERMINAL_STATES = new Set(["COMPLETED", "REJECTED", "WITHDRAWN", "OFFER_EXPIRED"]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function compareIso(a, b) {
  return String(a).localeCompare(String(b));
}

function currentRoundIndex(weekIndex) {
  return Math.floor((weekIndex - 1) / BALANCE.audition.roundIntervalWeeks) + 1;
}

function roundDescriptor(agencyId, weekIndex) {
  const index = currentRoundIndex(weekIndex);
  const startWeek = (index - 1) * BALANCE.audition.roundIntervalWeeks + 1;
  return { id: `audition_round_${agencyId}_${index}`, index, startWeek, endWeek: startWeek + BALANCE.audition.roundIntervalWeeks - 1 };
}

function availableWeeklySlots(state) {
  const workSlots = state.plan.filter((slot) => slot.actionId && !["REST", "LIFE"].includes(slot.actionId)).length;
  return Math.max(0, 12 - workSlots);
}

function validPortfolio(state) {
  const contents = (state.history.contents || [])
    .filter((content) => content.visibility === "PUBLIC" && Number.isFinite(Number(content.quality)))
    .map((content) => ({ id: content.id, date: content.publishedAt, quality: Number(content.quality), type: content.type || "PUBLIC_CONTENT" }));
  const projects = (state.history.portfolioWorks || [])
    .filter((work) => work.assetId)
    .map((work) => ({ id: work.id, date: work.publishedAt, quality: Number.isFinite(Number(work.evaluationScore)) ? Number(work.evaluationScore) : 40, type: work.kind }));
  return [...contents, ...projects].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
}

function commitmentScore(state) {
  const promises = (state.history.membershipPromises || []).filter((item) => ["FULFILLED", "OVERDUE"].includes(item.status)).slice(-8);
  const sponsorObligations = (state.sponsorships || []).filter((item) => ["DELIVERED", "CANCELLED"].includes(item.status)).slice(-8);
  const resolved = promises.length + sponsorObligations.length;
  const fulfilled = promises.filter((item) => item.status === "FULFILLED").length + sponsorObligations.filter((item) => item.status === "DELIVERED").length;
  return resolved ? 100 * fulfilled / resolved : 100;
}

function relationshipTrust(state) {
  const values = (state.relationships || []).map((relationship) => Number(relationship.workTrust)).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 50;
}

export function auditionEligibility(state, agencyId) {
  const agency = AGENCIES[agencyId];
  if (!agency) return { eligible: false, code: "INVALID_AGENCY", checks: {}, reasons: ["招募机构不存在"] };
  const template = agency.auditionTemplate;
  const works = validPortfolio(state);
  const languageAbility = template.supportedLanguages.includes(state.performer.primaryLanguage) ? 90 : 0;
  const availableSlots = availableWeeklySlots(state);
  const contractHandleable = !state.affiliation?.agencyId || state.affiliation.agencyId === agencyId || state.contract?.allowsExternalAuditions === true;
  const checks = {
    adult: state.channel.creatorIsAdult === true,
    language: languageAbility >= template.minimumPrimaryLanguage,
    availability: availableSlots >= template.minimumAvailableWeeklySlots,
    workHistory: works.length >= template.minimumValidWorks,
    contract: contractHandleable,
  };
  const reasons = [];
  if (!checks.adult) reasons.push("表演者成年条件未满足");
  if (!checks.language) reasons.push(`主语言能力需至少 ${template.minimumPrimaryLanguage}`);
  if (!checks.availability) reasons.push(`本周至少保留 ${template.minimumAvailableWeeklySlots} 个可投入工作格`);
  if (!checks.workHistory) reasons.push(`至少需要 ${template.minimumValidWorks} 份有效公开直播／创作记录`);
  if (!checks.contract) reasons.push("现有合同未允许接触外部招募或尚无可处理的退出安排");
  return { eligible: Object.values(checks).every(Boolean), checks, reasons, languageAbility, availableSlots, validWorks: works, subscriberCountIgnored: state.channel.subscribers };
}

export function auditionScore(state, agencyId) {
  const agency = AGENCIES[agencyId];
  if (!agency) throw new Error("INVALID_AGENCY");
  const template = agency.auditionTemplate;
  const works = validPortfolio(state);
  const coreSpecialty = Math.max(...template.relatedSkills.map((skill) => Number(state.performer.abilities[skill] || 0)));
  const workAverage = works.length ? works.reduce((sum, work) => sum + work.quality, 0) / works.length : 0;
  const representativeScores = (state.history.portfolioWorks || []).map((work) => Number(work.evaluationScore)).filter(Number.isFinite);
  const representative = representativeScores.length ? Math.max(...representativeScores) : 40;
  const portfolio = round2(clamp(0.70 * workAverage + 0.30 * representative, 0, 100));
  const scheduleFeasibility = clamp(availableWeeklySlots(state) / template.minimumAvailableWeeklySlots * 100, 0, 100);
  const continuity = round2(0.60 * commitmentScore(state) + 0.40 * scheduleFeasibility);
  const collaboration = round2(0.50 * Number(state.performer.abilities.collaboration || 0) + 0.50 * relationshipTrust(state));
  const directionFit = template.targetDirections.includes(state.performer.primaryDirection) ? 100 : 60;
  const languageFit = template.supportedLanguages.includes(state.performer.primaryLanguage) ? 100 : 0;
  const fit = round2(0.75 * directionFit + 0.25 * languageFit);
  const total = round2(0.30 * coreSpecialty + 0.25 * portfolio + 0.20 * continuity + 0.15 * collaboration + 0.10 * fit);
  return { coreSpecialty, portfolio, continuity, collaboration, fit, total, workIds: works.map((work) => work.id), formulaVersion: "AUDITION_SCORE_1_0" };
}

async function ensureAuditionRound(state, agencyId) {
  const descriptor = roundDescriptor(agencyId, state.weekIndex);
  const existing = state.auditionRounds.find((round) => round.id === descriptor.id);
  if (existing) return existing;
  const backgroundCandidateScores = [];
  for (let index = 0; index < BALANCE.audition.backgroundCandidatesPerRound; index += 1) {
    const draw = await deterministicRandom(state.seed, descriptor.startWeek, "audition_candidates", agencyId, index);
    backgroundCandidateScores.push(round2(55 + draw * 30));
  }
  const round = { ...descriptor, agencyId, slots: BALANCE.audition.slotsPerRound, candidateSeedScope: `${state.seed}/${descriptor.startWeek}/audition_candidates/${agencyId}`, backgroundCandidateScores, status: "OPEN", sourceType: "DESIGN_VALUE" };
  state.auditionRounds.push(round);
  return round;
}

function applicationMutation(sourceState, applicationId, allowedStates) {
  if (sourceState.phase !== "PLANNING") return { error: { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段处理招募申请" } };
  const original = sourceState.auditionApplications?.find((item) => item.id === applicationId);
  if (!original || !allowedStates.includes(original.status)) return { error: { ok: false, code: "REQUIREMENT_UNMET", message: "招募申请不存在或当前阶段不可执行此操作" } };
  const state = structuredClone(sourceState);
  return { state, application: state.auditionApplications.find((item) => item.id === applicationId) };
}

function cooldownRecord(state, agencyId) {
  return [...state.auditionApplications].reverse().find((item) => item.agencyId === agencyId && item.status === "REJECTED" && Number(item.cooldownUntilWeek || 0) > state.weekIndex);
}

function reject(application, state, reason, date) {
  application.status = "REJECTED";
  application.rejectedAt = date;
  application.rejectedAtWeek = state.weekIndex;
  application.cooldownUntilWeek = state.weekIndex + BALANCE.audition.reapplyCooldownWeeks;
  application.feedback = reason;
  application.terminalRecordRetained = true;
}

export function createAuditionApplication(sourceState, { agencyId, date }) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段建立招募申请" };
  if (!AGENCIES[agencyId]) return { ok: false, code: "INVALID_COMMAND", message: "招募机构无效" };
  if (sourceState.affiliation?.agencyId === agencyId) return { ok: false, code: "REQUIREMENT_UNMET", message: "当前已属于该机构，无需重复申请" };
  const cooling = cooldownRecord(sourceState, agencyId);
  if (cooling) return { ok: false, code: "AUDITION_COOLDOWN", message: `同一机构的落选冷却尚未结束，第 ${cooling.cooldownUntilWeek} 周可再次申请`, details: { cooldownUntilWeek: cooling.cooldownUntilWeek } };
  if (sourceState.auditionApplications?.some((item) => item.agencyId === agencyId && ACTIVE_STATES.has(item.status))) return { ok: false, code: "DUPLICATE_APPLICATION", message: "该机构已有进行中的申请" };
  const state = structuredClone(sourceState);
  const count = state.auditionApplications.filter((item) => item.agencyId === agencyId).length + 1;
  const application = {
    id: `audition_${state.id}_${agencyId}_${count}`,
    agencyId,
    roundId: null,
    templateId: AGENCIES[agencyId].auditionTemplate.id,
    status: "DRAFT_APPLICATION",
    eligibilitySnapshot: null,
    portfolioWorkIds: [],
    scoreBreakdown: null,
    interviewPrepModifier: 0,
    interviewTestsCompleted: 0,
    finalNoise: null,
    finalScore: null,
    candidateRank: null,
    conditionalOfferExpiresAt: null,
    offerExtensionUsed: false,
    contractHandlingProgress: state.affiliation?.agencyId ? 0 : 1,
    feedback: "草案不会占用当期名额；提交时才冻结资格、作品与分数。",
    createdAt: date,
    lastActionAt: date,
  };
  state.auditionApplications.push(application);
  state.snapshotVersion += 1;
  return { ok: true, state, application };
}

export async function submitAuditionApplication(sourceState, { applicationId, date }) {
  const context = applicationMutation(sourceState, applicationId, ["DRAFT_APPLICATION"]);
  if (context.error) return context.error;
  const { state, application } = context;
  const cooling = cooldownRecord(state, application.agencyId);
  if (cooling && cooling.id !== application.id) return { ok: false, code: "AUDITION_COOLDOWN", message: `第 ${cooling.cooldownUntilWeek} 周前不能重新申请该机构` };
  const eligibility = auditionEligibility(state, application.agencyId);
  if (!eligibility.eligible) return { ok: false, code: "REQUIREMENT_UNMET", message: eligibility.reasons.join("；"), details: { checks: eligibility.checks } };
  const score = auditionScore(state, application.agencyId);
  const round = await ensureAuditionRound(state, application.agencyId);
  application.status = "SUBMITTED";
  application.roundId = round.id;
  application.eligibilitySnapshot = structuredClone(eligibility);
  application.portfolioWorkIds = [...score.workIds];
  application.scoreBreakdown = score;
  application.submittedAt = date;
  application.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, application, round };
}

export function startAuditionScreening(sourceState, { applicationId, date }) {
  const context = applicationMutation(sourceState, applicationId, ["SUBMITTED"]);
  if (context.error) return context.error;
  const { state, application } = context;
  application.status = "SCREENING";
  application.screeningStartedAt = date;
  application.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, application };
}

export function resolveAuditionScreening(sourceState, { applicationId, date }) {
  const context = applicationMutation(sourceState, applicationId, ["SCREENING"]);
  if (context.error) return context.error;
  const { state, application } = context;
  if (application.scoreBreakdown.total < BALANCE.audition.screeningThreshold) reject(application, state, "需要更成熟的作品集或持续活动方案；订阅数不是拒绝依据。", date);
  else {
    application.status = "INTERVIEW_1";
    application.feedback = "初筛通过；请在排期中安排面试准备或已获邀面试。";
  }
  application.screeningResolvedAt = date;
  application.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, application };
}

export function applyAuditionPreparation(state, applicationId, date) {
  const application = state.auditionApplications.find((item) => item.id === applicationId);
  if (!application || !["INTERVIEW_1", "INTERVIEW_2"].includes(application.status)) throw new Error("REQUIREMENT_UNMET");
  application.interviewPrepModifier = Math.min(BALANCE.audition.interviewPrepCap, application.interviewPrepModifier + BALANCE.audition.interviewPrepPerSlot);
  application.lastActionAt = date;
  return application;
}

export async function applyAuditionTest(state, applicationId, date) {
  const application = state.auditionApplications.find((item) => item.id === applicationId);
  if (!application || !["INTERVIEW_1", "INTERVIEW_2"].includes(application.status)) throw new Error("REQUIREMENT_UNMET");
  application.interviewTestsCompleted += 1;
  application.lastActionAt = date;
  if (application.status === "INTERVIEW_1") {
    application.status = "INTERVIEW_2";
    application.feedback = "第一轮面试完成；可继续准备后安排最终测试。";
    return application;
  }
  const round = state.auditionRounds.find((item) => item.id === application.roundId);
  const draw = await deterministicRandom(state.seed, round.startWeek, "audition_final_test", application.id, 0);
  const span = BALANCE.audition.finalNoiseMaximum - BALANCE.audition.finalNoiseMinimum;
  application.finalNoise = round2(BALANCE.audition.finalNoiseMinimum + draw * span);
  application.finalScore = round2(application.scoreBreakdown.total + application.interviewPrepModifier + application.finalNoise);
  application.candidateRank = 1 + round.backgroundCandidateScores.filter((score) => score > application.finalScore).length;
  if (application.finalScore >= BALANCE.audition.finalThreshold && application.candidateRank <= round.slots) {
    application.status = "CONDITIONAL_OFFER";
    application.conditionalOfferExpiresAt = addDays(date, BALANCE.audition.offerValidityDays);
    application.feedback = "进入当期名额；附条件意向不等于已签约或保证出道。";
  } else if (application.finalScore >= BALANCE.audition.finalThreshold) reject(application, state, "作品匹配较好，但同期名额有限；不会降低工作信誉。", date);
  else reject(application, state, "最终候选分尚未达到 65；建议加强面试准备或作品持续性。", date);
  return application;
}

export function requestAuditionOfferExtension(sourceState, { applicationId, date }) {
  const context = applicationMutation(sourceState, applicationId, ["CONDITIONAL_OFFER"]);
  if (context.error) return context.error;
  const { state, application } = context;
  if (application.offerExtensionUsed) return { ok: false, code: "REQUIREMENT_UNMET", message: "该意向已经延长过一次" };
  if (application.contractHandlingProgress < 1) return { ok: false, code: "TRANSFER_REQUIREMENTS_UNMET", message: "现有合同处理尚无可验证进度，暂不能延长意向" };
  application.conditionalOfferExpiresAt = addDays(application.conditionalOfferExpiresAt, BALANCE.audition.offerExtensionDays);
  application.offerExtensionUsed = true;
  application.offerExtendedAt = date;
  application.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, application };
}

export function beginAuditionContractReview(sourceState, { applicationId, date }) {
  const context = applicationMutation(sourceState, applicationId, ["CONDITIONAL_OFFER"]);
  if (context.error) return context.error;
  const { state, application } = context;
  if (compareIso(date, application.conditionalOfferExpiresAt) > 0) {
    application.status = "OFFER_EXPIRED";
    application.feedback = "附条件意向已到期；申请记录保留。";
  } else {
    application.status = "CONTRACT_REVIEW";
    application.proposedContractSnapshot = { agencyId: application.agencyId, creatorPlatformShareBps: BALANCE.contracts.corporatePlatformCreatorShareBps, termWeeks: BALANCE.contracts.defaultTermWeeks, noticeWeeks: BALANCE.contracts.defaultNoticeWeeks, sourceType: "DESIGN_VALUE" };
  }
  application.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, application };
}

export function acceptAuditionContractReview(sourceState, { applicationId, date }) {
  const context = applicationMutation(sourceState, applicationId, ["CONTRACT_REVIEW"]);
  if (context.error) return context.error;
  const { state, application } = context;
  application.status = "PREPARING_DEBUT";
  application.contractReviewedAt = date;
  application.feedback = "招募流程已确认；所属、角色与频道切换仍须经过独立转籍方案。";
  application.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, application };
}

export function completeAudition(sourceState, { applicationId, date }) {
  const context = applicationMutation(sourceState, applicationId, ["PREPARING_DEBUT"]);
  if (context.error) return context.error;
  const { state, application } = context;
  application.status = "COMPLETED";
  application.completedAt = date;
  application.transferEligibility = { agencyId: application.agencyId, granted: true, sourceApplicationId: application.id };
  application.feedback = "已获录取资格；不会在未确认资产与所属方案时自动覆盖当前角色、频道或合同。";
  application.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, application };
}

export function withdrawAudition(sourceState, { applicationId, date }) {
  const context = applicationMutation(sourceState, applicationId, [...ACTIVE_STATES]);
  if (context.error) return context.error;
  const { state, application } = context;
  application.status = "WITHDRAWN";
  application.withdrawnAt = date;
  application.feedback = "申请已撤回；能力、现金、作品与工作信誉均保留。";
  application.terminalRecordRetained = true;
  application.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, application };
}

export function processAuditionDeadlines(state, date) {
  for (const application of state.auditionApplications || []) {
    if (application.status === "CONDITIONAL_OFFER" && compareIso(date, application.conditionalOfferExpiresAt) > 0) {
      application.status = "OFFER_EXPIRED";
      application.expiredAt = date;
      application.feedback = "附条件意向已到期；记录保留，可在未来招募期重新准备。";
      application.terminalRecordRetained = true;
    }
  }
}

export function isAuditionTerminal(status) {
  return TERMINAL_STATES.has(status);
}
