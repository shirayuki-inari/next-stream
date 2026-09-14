import { ROUTES } from "../../rules/agency_profiles.js";
import { BALANCE } from "../../rules/balance_standard_0_1.js";
import { ensureWorldWeek } from "./world.js";
import { ensureWeeklyEvent } from "./events.js";

export const TUTORIAL_STEPS = Object.freeze(["SCHEDULE", "FIRST_LIVE", "FIRST_VIDEO", "AUDIENCE_METRICS", "FINANCE_LAYERS", "CONTRACT_ASSETS"]);
export const CAREER_ENDING_TYPES = Object.freeze(["PAUSE", "PART_TIME", "GRADUATION", "INDEPENDENT", "STAY_COMPANY"]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createTutorialState() {
  return { skipped: false, completedSteps: [], rewardGranted: false, rewardJpy: "30000", sourceType: "TUTORIAL_EFFECT" };
}

function maybeGrantTutorialReward(state, date) {
  if (state.tutorial.rewardGranted || state.tutorial.completedSteps.length < TUTORIAL_STEPS.length) return false;
  const reward = BigInt(state.tutorial.rewardJpy);
  state.cash.free = String(BigInt(state.cash.free) + reward);
  state.history.journalEntries.push({
    id: "journal_tutorial_completion",
    date,
    sourceId: "tutorial_completion_reward",
    sourceType: "TUTORIAL_EFFECT",
    lines: [{ account: "CASH_FREE", debit: String(reward), credit: "0" }, { account: "GAME_REWARD", debit: "0", credit: String(reward) }],
  });
  state.tutorial.rewardGranted = true;
  state.tutorial.rewardGrantedAt = date;
  return true;
}

export function markTutorialProgressInPlace(state, stepId, date) {
  state.tutorial ??= createTutorialState();
  if (state.tutorial.skipped || state.tutorial.completedSteps.includes(stepId) || !TUTORIAL_STEPS.includes(stepId)) return false;
  state.tutorial.completedSteps.push(stepId);
  maybeGrantTutorialReward(state, date);
  return true;
}

export function acknowledgeTutorialStep(sourceState, { stepId, date }) {
  if (!TUTORIAL_STEPS.includes(stepId)) return { ok: false, code: "TUTORIAL_STEP_INVALID", message: "教程步骤不存在" };
  if (sourceState.weekIndex > 4) return { ok: false, code: "TUTORIAL_EXPIRED", message: "前四周引导期已经结束" };
  const state = structuredClone(sourceState);
  markTutorialProgressInPlace(state, stepId, date);
  state.snapshotVersion += 1;
  return { ok: true, state };
}

export function skipTutorial(sourceState) {
  const state = structuredClone(sourceState);
  state.tutorial ??= createTutorialState();
  state.tutorial.skipped = true;
  state.snapshotVersion += 1;
  return { ok: true, state };
}

function dateWithinRecentWeeks(date, currentWeek, weeks = 8) {
  const end = Date.parse(`${BALANCE.calendar.startDate}T00:00:00Z`) + (currentWeek * 7 - 1) * 86400000;
  const startExclusive = end - weeks * 7 * 86400000;
  const value = Date.parse(`${date}T00:00:00Z`);
  return value > startExclusive && value <= end;
}

function attributableIncomeLastEightWeeks(state) {
  const incomeAccounts = new Set(["OTHER_INCOME", "SC", "MEMBERSHIP", "ADS", "SPONSOR", "MERCH_REVENUE", "ROYALTY"]);
  return state.history.journalEntries
    .filter((entry) => dateWithinRecentWeeks(entry.date, state.weekIndex, 8) && entry.sourceType !== "TUTORIAL_EFFECT")
    .reduce((total, entry) => total + entry.lines.filter((line) => incomeAccounts.has(line.account)).reduce((sum, line) => sum + BigInt(line.credit) - BigInt(line.debit), 0n), 0n);
}

function promiseFulfillmentRate(state) {
  const relevant = (state.history.membershipPromises || []).filter((promise) => ["FULFILLED", "OVERDUE"].includes(promise.status));
  if (!relevant.length) return 100;
  return Math.round(relevant.filter((promise) => promise.status === "FULFILLED").length / relevant.length * 100);
}

function incomeSourceCount(state) {
  const sources = new Set();
  for (const entry of state.history.journalEntries.filter((item) => dateWithinRecentWeeks(item.date, state.weekIndex, 8))) {
    for (const line of entry.lines) if (["OTHER_INCOME", "SC", "MEMBERSHIP", "ADS", "SPONSOR", "MERCH_REVENUE", "ROYALTY"].includes(line.account) && BigInt(line.credit) > 0n) sources.add(line.account);
  }
  return sources.size;
}

export function evaluateCareerGoal(state) {
  const reports = state.history.weeklyReports.slice(-8);
  const averageStress = reports.length ? Math.round(reports.reduce((sum, report) => sum + report.state.stress, 0) / reports.length) : state.performer.stress;
  const incomeTotal = attributableIncomeLastEightWeeks(state);
  const averageWeeklyIncome = incomeTotal / 8n;
  const weeklyBasics = BigInt(BALANCE.costs.weeklyLivingJpy) + BigInt(ROUTES[state.routeId].weeklyToolCost);
  const cashCoverageWeeks = Number(BigInt(state.cash.free) / (weeklyBasics || 1n));
  const fulfillmentRate = promiseFulfillmentRate(state);
  const contents = state.history.contents || [];
  const portfolioCount = (state.history.portfolioWorks || []).length;
  const collaborationCount = (state.collaborationHistory || []).length;
  const playerOwnedAssets = state.assets.filter((asset) => asset.ownerParty === "PLAYER").length;
  const sourceCount = incomeSourceCount(state);
  const directionCounts = new Set(contents.map((content) => content.actionId)).size;
  const common = { sampleWeeks: reports.length, averageStress, incomeTotalJpy: String(incomeTotal), averageWeeklyIncomeJpy: String(averageWeeklyIncome), weeklyBasicsJpy: String(weeklyBasics), cashCoverageWeeks, fulfillmentRate };
  const evaluators = {
    livelihood: { achieved: reports.length >= 8 && averageWeeklyIncome >= weeklyBasics && cashCoverageWeeks >= 4 && averageStress < 70 && fulfillmentRate >= 80, measures: common },
    creator: { achieved: portfolioCount >= 3 && contents.length >= 8 && directionCounts >= 2, measures: { portfolioCount, publishedContentCount: contents.length, contentFormats: directionCounts, ...common } },
    stage: { achieved: contents.filter((item) => ["LIVE_MUSIC", "LIVE_COLLAB"].includes(item.actionId)).length >= 6 && collaborationCount >= 2 && state.performer.abilities.performance >= 60, measures: { stageAndMusicCount: contents.filter((item) => ["LIVE_MUSIC", "LIVE_COLLAB"].includes(item.actionId)).length, collaborationCount, performance: state.performer.abilities.performance, ...common } },
    community: { achieved: state.metrics.active28dEstimate >= 1000 && fulfillmentRate >= 80 && averageStress < 70, measures: { active28dEstimate: state.metrics.active28dEstimate, fulfillmentRate, averageStress } },
    brand: { achieved: playerOwnedAssets >= 2 && sourceCount >= 3 && cashCoverageWeeks >= 4, measures: { playerOwnedAssets, incomeSourceCount: sourceCount, cashCoverageWeeks } },
    reach: { achieved: state.metrics.active28dEstimate >= 10000 && contents.length >= 16 && directionCounts >= 3, measures: { active28dEstimate: state.metrics.active28dEstimate, publishedContentCount: contents.length, contentFormats: directionCounts } },
  };
  return { goalId: state.performer.careerGoal, ...evaluators[state.performer.careerGoal] };
}

export function generateCareerRetrospective(state) {
  const existing = state.careerRetrospectives?.find((item) => item.throughWeek === 104);
  if (existing) return existing;
  const incomeTotals = Object.fromEntries(["scCreatorEarned", "membershipCreatorEarned", "adsCreatorEarned", "sponsorCreatorEarned", "royaltyCreatorEarned", "projectProfit"].map((key) => [key, state.finance[key] || "0"]));
  const reports = state.history.weeklyReports.slice(0, 104);
  const averageFatigue = reports.length ? Math.round(reports.reduce((sum, report) => sum + report.state.fatigue, 0) / reports.length) : state.performer.fatigue;
  const averageStress = reports.length ? Math.round(reports.reduce((sum, report) => sum + report.state.stress, 0) / reports.length) : state.performer.stress;
  const retrospective = {
    id: "career_retrospective_104",
    throughWeek: 104,
    works: { published: state.history.contents.length, portfolio: state.history.portfolioWorks.length, projects: state.projects.filter((item) => ["PUBLISHED", "LONG_TAIL", "ARCHIVED", "SETTLED"].includes(item.status)).length },
    collaborations: { completed: state.collaborationHistory.length, partners: new Set(state.collaborationHistory.map((item) => item.npcId)).size },
    transfers: { total: state.transferCases.length, completed: state.transferCases.filter((item) => ["CLOSED", "REBUILDING", "SWITCHED"].includes(item.status)).length, affiliationHistory: state.affiliationHistory.length },
    incomeStructure: incomeTotals,
    healthLoad: { averageFatigue, averageStress, currentPhysicalCondition: state.performer.physicalCondition },
    keyChoices: state.textEvents.filter((event) => event.decisions.length).slice(-12).map((event) => ({ eventId: event.id, title: event.title, choices: event.decisions.map((decision) => decision.choiceId) })),
    goalEvaluation: evaluateCareerGoal(state),
    outcomePolicy: "继续、暂停、兼职、毕业、独立或留社均是正常结果；不以百万订阅作为统一成败线。",
  };
  state.careerRetrospectives.push(retrospective);
  return retrospective;
}

export function continueAfterRetrospective(sourceState) {
  if (sourceState.phase !== "RETROSPECTIVE" || sourceState.weekIndex !== 104) return { ok: false, code: "RETROSPECTIVE_NOT_READY", message: "当前没有待确认的两年回顾" };
  const state = structuredClone(sourceState);
  state.weekIndex = 105;
  state.phase = "PLANNING";
  state.plan = Array.from({ length: 14 }, (_, index) => ({ index, actionId: [5, 9, 12, 13].includes(index) ? "LIFE" : null, locked: [12, 13].includes(index), flexibleLife: [5, 9].includes(index), pairId: null, targetId: null, targetType: null }));
  state.metrics.subscriberDelta = 0;
  ensureWorldWeek(state, 105);
  ensureWeeklyEvent(state);
  state.snapshotVersion += 1;
  return { ok: true, state };
}

export function endCareer(sourceState, { outcomeId, date }) {
  if (sourceState.phase !== "RETROSPECTIVE" || sourceState.weekIndex !== 104) return { ok: false, code: "RETROSPECTIVE_NOT_READY", message: "当前没有待确认的两年回顾" };
  if (!CAREER_ENDING_TYPES.includes(outcomeId)) return { ok: false, code: "INVALID_CAREER_ENDING", message: "生涯结果类型不存在" };
  const state = structuredClone(sourceState);
  state.phase = "CAREER_ENDED";
  state.careerEnding = {
    outcomeId,
    endedAt: date,
    throughWeek: 104,
    voluntary: true,
    goalEvaluation: evaluateCareerGoal(state),
    retrospectiveId: state.careerRetrospectives.at(-1)?.id || null,
  };
  state.snapshotVersion += 1;
  return { ok: true, state };
}
