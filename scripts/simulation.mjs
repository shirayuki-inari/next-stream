import { createDefaultPlan, createGame, isoAddDays, settleWeek, acknowledgeReport, validatePlan, weekDateRange } from "../src/domain/engine.js";
import { pathToFileURL } from "node:url";
import { applyForAds, applyForFanFunding } from "../src/domain/finance.js";
import {
  closeMerchSales,
  confirmMerchProject,
  createMerchProject,
  openMerchSales,
  processMerchProjectDate,
  promoteMerchProject,
  settleMerchProject,
} from "../src/domain/merch.js";
import { validateGameState } from "../src/storage.js";

export const ROUTE_IDS = Object.freeze(["indie", "homolive", "niji2434"]);
export const STRATEGY_IDS = Object.freeze(["conservative", "trend", "music", "merch"]);

export const STRATEGY_LABELS = Object.freeze({
  conservative: "保守经营",
  trend: "追热点",
  music: "音乐专精",
  merch: "商品经营",
});

const BALANCED_ABILITIES = Object.freeze({ expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 });
const ORDINARY_SLOTS = Object.freeze([0, 1, 2, 3, 4, 6, 7, 8, 10, 11]);
const ACTIVE_MERCH_STATES = new Set(["DRAFT", "APPROVED", "DESIGNING", "SAMPLING", "READY_TO_SELL", "ON_SALE", "SALES_CLOSED", "PRODUCING", "READY_TO_SHIP", "FULFILLING", "AFTER_SALES", "PAUSED"]);
const MERCH_DEFAULT_STATES = new Set(["CANCELLED", "REFUND_PENDING", "DEFAULTED", "BREACHED"]);

const BASE_ACTIONS = Object.freeze({
  conservative: ["PREPARE_CONTENT", "LIVE_GAME", "REVIEW", "PRACTICE", "LIVE_CHAT", "EDIT_VIDEO", "NETWORK"],
  trend: ["PREPARE_CONTENT", "MAKE_SHORT", "MAKE_SHORT", "LIVE_CHAT", "MAKE_SHORT", "EDIT_VIDEO", "LIVE_GAME", "MAKE_SHORT", "REVIEW", "MAKE_SHORT"],
  music: ["PREPARE_CONTENT", "LIVE_MUSIC", "PRACTICE", "PREPARE_CONTENT", "LIVE_MUSIC", "PRACTICE", "EDIT_VIDEO", "LIVE_MUSIC", "REVIEW", "LIVE_MUSIC"],
  merch: ["PREPARE_CONTENT", "LIVE_CHAT", "MAKE_SHORT", "EDIT_VIDEO", "LIVE_GAME", "REVIEW", "BUSINESS_ADMIN"],
});

function unwrap(result, operation) {
  if (!result?.ok) throw new Error(`${operation}: ${result?.code || "UNKNOWN"} ${result?.message || ""}`.trim());
  return result.state;
}

function compareIso(left, right) {
  return String(left).localeCompare(String(right));
}

function placeSingle(plan, actionId, options = {}) {
  const slot = ORDINARY_SLOTS.find((index) => !plan[index].actionId);
  if (slot == null) return false;
  Object.assign(plan[slot], { actionId, pairId: null, targetId: options.targetId || null, targetType: options.targetType || null });
  return true;
}

function placePartTime(plan, weekIndex) {
  for (const [first, second] of [[0, 1], [2, 3], [6, 7], [10, 11]]) {
    if (plan[first].actionId || plan[second].actionId) continue;
    const pairId = `sim_part_time_w${weekIndex}_${first}`;
    Object.assign(plan[first], { actionId: "PART_TIME", pairId, targetId: null, targetType: null });
    Object.assign(plan[second], { actionId: "PART_TIME", pairId, targetId: null, targetType: null });
    return true;
  }
  return false;
}

function planWeek(state, strategyId) {
  const plan = createDefaultPlan();
  const pendingPromise = state.history.membershipPromises.find((item) => ["DUE", "OVERDUE"].includes(item.status));
  if (pendingPromise) placeSingle(plan, "BUSINESS_ADMIN", { targetId: pendingPromise.id, targetType: "MEMBERSHIP_PROMISE" });

  if (strategyId === "merch") {
    const project = state.projects.find((item) => item.type === "MERCH" && item.status === "DESIGNING");
    const remaining = project ? Math.max(0, project.designWorkRequired - project.designWorkCompleted) : 0;
    for (let index = 0; index < Math.min(2, remaining); index += 1) {
      placeSingle(plan, "PROJECT_WORK", { targetId: project.id, targetType: "MERCH_PROJECT" });
    }
  }

  if (BigInt(state.cash.free) < 120_000n) placePartTime(plan, state.weekIndex);
  for (const actionId of BASE_ACTIONS[strategyId]) placeSingle(plan, actionId);
  const validation = validatePlan(plan);
  if (!validation.ok) throw new Error(`strategy plan invalid: ${validation.code} ${validation.message}`);
  return plan;
}

function processMerchLifecycle(sourceState, date) {
  let state = sourceState;
  const project = state.projects.find((item) => item.type === "MERCH" && ACTIVE_MERCH_STATES.has(item.status));
  if (!project) return state;
  let current = project;

  if (["SAMPLING", "PRODUCING", "FULFILLING"].includes(current.status)) {
    const due = current.status === "SAMPLING" ? current.samplingDueDate : current.status === "PRODUCING" ? current.productionDueDate : current.fulfillmentDueDate;
    if (compareIso(date, due) >= 0) {
      state = unwrap(processMerchProjectDate(state, { projectId: current.id, date }), "process merch date");
      current = state.projects.find((item) => item.id === current.id);
    }
  }
  if (current.status === "READY_TO_SELL") {
    state = unwrap(openMerchSales(state, { projectId: current.id, date }), "open merch sales");
    state = unwrap(promoteMerchProject(state, { projectId: current.id, date }), "promote merch opening");
    current = state.projects.find((item) => item.id === current.id);
  } else if (current.status === "ON_SALE" && compareIso(date, current.salesEndDate) <= 0) {
    state = unwrap(promoteMerchProject(state, { projectId: current.id, date }), "promote merch");
    current = state.projects.find((item) => item.id === current.id);
  }
  if (current.status === "ON_SALE" && compareIso(date, current.salesEndDate) > 0) {
    state = unwrap(closeMerchSales(state, { projectId: current.id, date }), "close merch sales");
    current = state.projects.find((item) => item.id === current.id);
  }
  if (current.status === "FULFILLING" && compareIso(date, current.fulfillmentDueDate) >= 0) {
    state = unwrap(processMerchProjectDate(state, { projectId: current.id, date }), "fulfill merch");
    current = state.projects.find((item) => item.id === current.id);
  }
  if (current.status === "AFTER_SALES" && compareIso(date, current.afterSalesEndDate) >= 0) {
    state = unwrap(settleMerchProject(state, { projectId: current.id, date }), "settle merch");
  }
  return state;
}

function maybeStartMerchProject(sourceState, strategyId, date) {
  if (strategyId !== "merch" || sourceState.weekIndex < 8 || sourceState.weekIndex % 12 !== 8) return sourceState;
  if (sourceState.projects.some((item) => item.type === "MERCH" && ACTIVE_MERCH_STATES.has(item.status))) return sourceState;
  if (!sourceState.affiliation.agencyId && BigInt(sourceState.cash.free) < 100_000n) return sourceState;
  const fundingModel = sourceState.affiliation.agencyId ? "COMPANY_LED" : "SELF_RUN";
  let state = unwrap(createMerchProject(sourceState, { date, templateId: "DIGITAL_VOICE_PACK_STANDARD", fundingModel }), "create merch");
  const projectId = state.projects.at(-1).id;
  state = unwrap(confirmMerchProject(state, { projectId, date }), "confirm merch");
  return state;
}

function maybeApplyForMonetization(sourceState, date) {
  let state = sourceState;
  if (state.channel.fanFundingStatus === "ELIGIBLE_TO_APPLY") state = unwrap(applyForFanFunding(state, date), "apply fan funding");
  if (state.channel.adsStatus === "ELIGIBLE_TO_APPLY") state = unwrap(applyForAds(state, date), "apply ads");
  return state;
}

function duplicateIds(values) {
  const ids = values.map((item) => item?.id).filter(Boolean);
  return ids.length !== new Set(ids).size;
}

export function assertTrajectoryIntegrity(state) {
  validateGameState(state);
  const collections = [
    state.projects,
    state.sponsorships,
    state.transferCases,
    state.auditionApplications,
    state.textEvents,
    state.history.contents,
    state.history.weeklyReports,
    state.history.platformTransactions,
    state.history.receivables,
    state.history.journalEntries,
  ];
  if (collections.some(duplicateIds)) throw new Error("trajectory contains duplicate stable IDs");
  for (const project of state.projects) {
    for (const field of ["orderCount", "deliveredOrders", "productionQuantity", "inventoryQuantity", "reservedInventoryQuantity"]) {
      if (Number(project[field] || 0) < 0) throw new Error(`negative project quantity: ${project.id}.${field}`);
    }
  }
  const contentIds = new Set(state.history.contents.map((item) => item.id));
  if (state.history.subscriberChanges.some((item) => item.sourceId && !contentIds.has(item.sourceId))) throw new Error("subscriber change has dangling content reference");
  return true;
}

function projectDefaultCount(state) {
  return state.projects.filter((item) => MERCH_DEFAULT_STATES.has(item.status) || item.status === "OVERDUE").length;
}

function membershipFulfillmentRate(state) {
  const decided = state.history.membershipPromises.filter((item) => ["FULFILLED", "OVERDUE"].includes(item.status));
  if (!decided.length) return 1;
  return decided.reduce((sum, item) => sum + Math.min(1, item.fulfilledUnits / Math.max(1, item.requiredUnits)), 0) / decided.length;
}

function metricSnapshot(state, weekIndex) {
  return {
    week: weekIndex,
    subscribers: state.channel.subscribers,
    active: state.metrics.active28dEstimate,
    cashFreeJpy: state.cash.free,
    cashRestrictedJpy: state.cash.restricted,
    receivableJpy: state.cash.receivable,
    fatigue: state.performer.fatigue,
    stress: state.performer.stress,
    physicalCondition: state.performer.physicalCondition,
    projectDefaults: projectDefaultCount(state),
    careerChanges: state.affiliationHistory.length,
    membershipFulfillmentRate: membershipFulfillmentRate(state),
  };
}

function objectiveScores(state) {
  const musicContents = state.history.contents.filter((item) => item.actionId === "LIVE_MUSIC").length;
  const fulfilled = state.history.membershipPromises.filter((item) => item.status === "FULFILLED").length;
  return {
    livelihood: Number(state.cash.free) + Number(state.cash.receivable),
    creator: state.channel.subscribers + state.history.contents.length * 10,
    stage: musicContents * 1000 + state.performer.abilities.performance * 100,
    community: state.metrics.active28dEstimate + fulfilled * 500,
    brand: Number(state.finance.projectProfit || 0) + state.projects.filter((item) => item.status === "SETTLED").length * 10_000,
    reach: state.channel.subscribers,
  };
}

export async function runTrajectory({ routeId, strategyId, seed, weeks = 104, validateEveryWeek = false, returnState = false } = {}) {
  if (!ROUTE_IDS.includes(routeId)) throw new Error(`unknown route: ${routeId}`);
  if (!STRATEGY_IDS.includes(strategyId)) throw new Error(`unknown strategy: ${strategyId}`);
  let state = createGame({
    mode: "direct",
    routeId,
    performerCode: "SIM",
    characterName: "验证角色",
    primaryLanguage: "jp",
    primaryDirection: "creative",
    careerGoal: "creator",
    seed,
    abilities: BALANCED_ABILITIES,
  });
  const checkpoints = {};
  let zeroCashWeeks = 0;
  const settlementDurationsMs = [];
  const startedAt = performance.now();

  for (let week = 1; week <= weeks; week += 1) {
    if (state.phase !== "PLANNING" || state.weekIndex !== week) throw new Error(`unexpected phase before week ${week}: ${state.phase}/${state.weekIndex}`);
    const date = weekDateRange(week).start;
    state = processMerchLifecycle(state, date);
    state = maybeStartMerchProject(state, strategyId, date);
    state = maybeApplyForMonetization(state, date);
    state.plan = planWeek(state, strategyId);
    const settlementStartedAt = performance.now();
    const settled = await settleWeek(state);
    settlementDurationsMs.push(performance.now() - settlementStartedAt);
    state = unwrap(settled, `settle week ${week}`);
    if (BigInt(state.cash.free) === 0n) zeroCashWeeks += 1;
    if ([26, 52, 104].includes(week)) {
      assertTrajectoryIntegrity(state);
      checkpoints[week] = metricSnapshot(state, week);
    } else if (validateEveryWeek) assertTrajectoryIntegrity(state);
    if (week < weeks || week === 104) state = unwrap(acknowledgeReport(state), `acknowledge week ${week}`);
  }

  if (weeks === 104 && state.phase !== "RETROSPECTIVE") throw new Error(`104-week run did not reach retrospective: ${state.phase}`);
  assertTrajectoryIntegrity(state);
  const final = checkpoints[weeks] || metricSnapshot(state, weeks);
  const sustainable = BigInt(final.cashFreeJpy) > 0n
    && final.fatigue < 80
    && final.stress < 80
    && final.physicalCondition >= 30
    && final.projectDefaults === 0
    && final.membershipFulfillmentRate >= 0.8;
  const summary = {
    routeId,
    strategyId,
    seed,
    weeks,
    checkpoints,
    finalPhase: state.phase,
    sustainable,
    zeroCashWeeks,
    projectCount: state.projects.length,
    settledProjectCount: state.projects.filter((item) => item.status === "SETTLED").length,
    projectProfitJpy: state.finance.projectProfit || "0",
    royaltyCreatorEarnedJpy: state.finance.royaltyCreatorEarned || "0",
    contentCount: state.history.contents.length,
    journalCount: state.history.journalEntries.length,
    saveBytes: Buffer.byteLength(JSON.stringify(state), "utf8"),
    objectiveScores: objectiveScores(state),
    settlementDurationsMs: settlementDurationsMs.map((value) => Math.round(value * 100) / 100),
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
  if (returnState) summary.state = state;
  return summary;
}

export function deterministicSeed(index) {
  return `balance-v1-${String(index).padStart(3, "0")}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [routeId = "indie", strategyId = "conservative", seed = "balance-smoke"] = process.argv.slice(2);
  const result = await runTrajectory({ routeId, strategyId, seed, validateEveryWeek: true });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
