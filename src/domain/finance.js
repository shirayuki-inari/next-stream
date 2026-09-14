import { ROUTES } from "../../rules/agency_profiles.js";
import { BALANCE } from "../../rules/balance_standard_0_1.js";
import { PLATFORM_RULES, SC_DENOMINATIONS, SUPPORT_TIERS } from "../../rules/platform_youtube_reference_2026_09_12_v1.js";
import { deterministicRandom } from "./random.js";

function asMoney(value) {
  const money = BigInt(value);
  if (money < 0n) throw new Error("INVALID_FINANCIAL_BASIS");
  return money;
}

function addMoney(target, key, amount) {
  target[key] = String(BigInt(target[key] || 0) + BigInt(amount));
}

function compareIso(a, b) {
  return String(a).localeCompare(String(b));
}

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.floor((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function membershipCycleForDate(date) {
  const cycleDays = BALANCE.membership.cycleDays;
  const elapsed = Math.max(0, daysBetween(BALANCE.calendar.startDate, date));
  const cycleIndex = Math.floor(elapsed / cycleDays);
  const startsAt = addDays(BALANCE.calendar.startDate, cycleIndex * cycleDays);
  return { cycleId: `membership_cycle_${cycleIndex + 1}`, startsAt, dueDate: addDays(startsAt, cycleDays - 1) };
}

export function membershipRenewalProbability({ loyalty, benefitFulfillment, unfulfilledPromises }) {
  return Math.max(0.1, Math.min(0.95, 0.55 + 0.30 * loyalty / 100 + 0.10 * benefitFulfillment - 0.20 * unfulfilledPromises));
}

export function ensureMembershipPromise(state, date) {
  const cycle = membershipCycleForDate(date);
  const existing = state.history.membershipPromises.find((promise) => promise.channelId === state.channel.id && promise.cycleId === cycle.cycleId);
  if (existing) return existing;
  const policy = state.membershipProgram.promisePolicy;
  const requiredUnits = policy === "LIGHT" ? BALANCE.membership.lightPromiseUnits : BALANCE.membership.standardPromiseUnits;
  const promise = {
    id: `membership_promise_${state.channel.id}_${cycle.cycleId}`,
    channelId: state.channel.id,
    cycleId: cycle.cycleId,
    startsAt: cycle.startsAt,
    dueDate: cycle.dueDate,
    policy,
    requiredUnits,
    fulfilledUnits: 0,
    benefits: policy === "LIGHT" ? ["固定文字更新"] : ["会员限定内容", "固定文字更新"],
    status: "DUE",
    sourceType: "DESIGN_VALUE",
  };
  state.history.membershipPromises.push(promise);
  return promise;
}

export function processMembershipPromiseDeadlines(state, date) {
  let overdue = 0;
  for (const promise of state.history.membershipPromises) {
    if (promise.status !== "DUE" || compareIso(promise.dueDate, date) >= 0) continue;
    if (promise.fulfilledUnits >= promise.requiredUnits) {
      promise.status = "FULFILLED";
      continue;
    }
    promise.status = "OVERDUE";
    promise.overdueAt = date;
    promise.unfulfilledUnits = promise.requiredUnits - promise.fulfilledUnits;
    overdue += 1;
  }
  const completed = [...state.history.membershipPromises].reverse().find((promise) => ["FULFILLED", "OVERDUE"].includes(promise.status));
  if (completed) state.membershipProgram.recentFulfillment = completed.requiredUnits ? completed.fulfilledUnits / completed.requiredUnits : 1;
  return { overdue };
}

export function fulfillMembershipPromise(state, promiseId, date) {
  const promise = state.history.membershipPromises.find((item) => item.id === promiseId);
  if (!promise || !["DUE", "OVERDUE"].includes(promise.status)) throw new Error("REQUIREMENT_UNMET");
  promise.fulfilledUnits = promise.requiredUnits;
  promise.unfulfilledUnits = 0;
  promise.status = "FULFILLED";
  promise.fulfilledAt = date;
  state.membershipProgram.recentFulfillment = 1;
  return { promiseId, fulfilledUnits: promise.requiredUnits, status: promise.status };
}

export function setMembershipPolicy(sourceState, { promisePolicy, chargesPaused, date }) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段调整会员方案" };
  if (!["STANDARD", "LIGHT"].includes(promisePolicy) || typeof chargesPaused !== "boolean") return { ok: false, code: "INVALID_COMMAND", message: "会员方案参数无效" };
  const state = structuredClone(sourceState);
  if (state.membershipProgram.promisePolicy === promisePolicy && state.membershipProgram.chargesPaused === chargesPaused) return { ok: false, code: "NO_CHANGE", message: "会员方案没有变化" };
  state.membershipProgram.promisePolicy = promisePolicy;
  state.membershipProgram.chargesPaused = chargesPaused;
  state.history.membershipPolicyChanges.push({ id: `membership_policy_${state.snapshotVersion + 1}`, date, promisePolicy, chargesPaused });
  state.snapshotVersion += 1;
  return { ok: true, state };
}

export function payRefundPayable(sourceState, { amountJpy, date }) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段处理退款应付款" };
  const amount = BigInt(amountJpy || 0);
  const payable = BigInt(sourceState.liabilities.refundPayable || 0);
  const totalPayable = BigInt(sourceState.cash.payable || 0);
  const creatorReceived = BigInt(sourceState.finance.scCreatorReceived || 0);
  if (amount <= 0n || amount > payable) return { ok: false, code: "INVALID_FINANCIAL_BASIS", message: "还款金额必须大于 0 且不超过退款应付款" };
  if (amount > totalPayable || amount > creatorReceived) return { ok: false, code: "INVALID_FINANCIAL_BASIS", message: "退款应付款与个人账不一致，请恢复上一份有效快照" };
  if (amount > BigInt(sourceState.cash.free)) return { ok: false, code: "INSUFFICIENT_FREE_CASH", message: "自由现金不足，不能使用履约受限资金支付退款" };
  const state = structuredClone(sourceState);
  state.cash.free = String(BigInt(state.cash.free) - amount);
  state.cash.payable = String(BigInt(state.cash.payable) - amount);
  state.liabilities.refundPayable = String(BigInt(state.liabilities.refundPayable) - amount);
  state.finance.scCreatorReceived = String(BigInt(state.finance.scCreatorReceived) - amount);
  const settlement = { id: `refund_payable_payment_${state.snapshotVersion + 1}`, date, amountJpy: String(amount), remainingJpy: state.liabilities.refundPayable };
  state.history.payableSettlements.push(settlement);
  pushJournal(state, {
    id: `journal_${settlement.id}`,
    date,
    sourceId: settlement.id,
    lines: [
      { account: "REFUND_PAYABLE", debit: String(amount), credit: "0" },
      { account: "CASH_FREE", debit: "0", credit: String(amount) },
    ],
  });
  state.snapshotVersion += 1;
  return { ok: true, state, settlement };
}

function addCalendarMonths(isoDate, months) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const firstOfTarget = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = firstOfTarget.getUTCFullYear();
  const targetMonth = firstOfTarget.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function isValidPublicContent(content) {
  return content.visibility === "PUBLIC" && content.deletedAt == null && content.validForEligibility !== false;
}

export function recalculateEligibilityWindows(state, date) {
  const ninetyDayLowerExclusive = addDays(date, -90);
  const twelveMonthLowerExclusive = addCalendarMonths(date, -12);
  const inWindow = (publishedAt, lowerExclusive) => compareIso(publishedAt, lowerExclusive) > 0 && compareIso(publishedAt, date) <= 0;
  const contents = state.history.contents.filter(isValidPublicContent);
  const uploadTypes = new Set(["SHORT", "VIDEO"]);
  const validPublicUploads90d = contents.filter((content) => uploadTypes.has(content.type) && inWindow(content.publishedAt, ninetyDayLowerExclusive)).length;
  const validWatchMinutes12m = contents.filter((content) => content.type !== "SHORT" && inWindow(content.publishedAt, twelveMonthLowerExclusive)).reduce((sum, content) => sum + Number(content.watchMinutes || 0), 0);
  const shortsViews90d = contents.filter((content) => content.type === "SHORT" && inWindow(content.publishedAt, ninetyDayLowerExclusive)).reduce((sum, content) => sum + Number(content.uniqueEstimate || 0), 0);
  Object.assign(state.channel, { validPublicUploads90d, validWatchMinutes12m, shortsViews90d, eligibilityCalculatedAt: date });
  return { validPublicUploads90d, validWatchMinutes12m, shortsViews90d, ninetyDayLowerExclusive, twelveMonthLowerExclusive };
}

export function calculateScWaterfall({ grossJpy, refundsJpy = "0", adjustmentsJpy = "0", platformShareBps = PLATFORM_RULES.fanFundingNetShareBps, creatorShareBps }) {
  const gross = asMoney(grossJpy);
  const refunds = asMoney(refundsJpy);
  const adjustments = asMoney(adjustmentsJpy);
  const basis = gross > refunds + adjustments ? gross - refunds - adjustments : 0n;
  const channelNet = basis * BigInt(platformShareBps) / 10000n;
  const creatorEarned = channelNet * BigInt(creatorShareBps) / 10000n;
  return {
    basisJpy: String(basis),
    channelNetJpy: String(channelNet),
    creatorEarnedJpy: String(creatorEarned),
    companyEarnedJpy: String(channelNet - creatorEarned),
  };
}

export function fanFundingEligibility(channel) {
  const threshold = PLATFORM_RULES.fanFunding;
  const watchPath = Number(channel.validWatchMinutes12m || 0) >= threshold.validWatchMinutes12m;
  const shortsPath = Number(channel.shortsViews90d || 0) >= threshold.shortsViews90d;
  const checks = {
    subscribers: Number(channel.subscribers || 0) >= threshold.subscribers,
    publicUploads: Number(channel.validPublicUploads90d || 0) >= threshold.publicUploads90d,
    watchOrShorts: watchPath || shortsPath,
    adult: channel.creatorIsAdult !== false,
    region: channel.regionAvailable !== false,
    channelStanding: channel.channelStanding !== "RESTRICTED",
  };
  return { eligible: Object.values(checks).every(Boolean), checks, watchPath, shortsPath };
}

export function adsEligibility(channel) {
  const threshold = PLATFORM_RULES.ads;
  const checks = {
    subscribers: Number(channel.subscribers || 0) >= threshold.subscribers,
    watchOrShorts: Number(channel.validWatchMinutes12m || 0) >= threshold.validWatchMinutes12m || Number(channel.shortsViews90d || 0) >= threshold.shortsViews90d,
    adult: channel.creatorIsAdult !== false,
    region: channel.regionAvailable !== false,
    channelStanding: channel.channelStanding !== "RESTRICTED",
  };
  return { eligible: Object.values(checks).every(Boolean), checks };
}

export function canReceiveSc(channel, content) {
  const checks = {
    fanFundingApproved: channel.fanFundingStatus === "APPROVED",
    termsAccepted: channel.commerceTermsAccepted === true,
    featureEnabled: channel.scFeatureEnabled === true,
    regionAvailable: channel.regionAvailable !== false,
    creatorAdult: channel.creatorIsAdult !== false,
    public: content.visibility === "PUBLIC",
    notAgeRestricted: content.ageRestricted !== true,
    notMadeForKids: content.madeForKids !== true,
    liveChatEnabled: content.liveChatEnabled !== false,
    noFundraiser: content.usesGivingFundraiser !== true,
    supportedType: ["LIVE", "PREMIERE"].includes(content.type),
  };
  return { allowed: Object.values(checks).every(Boolean), checks };
}

export function createAudienceBudgets(segments, performerId) {
  return segments.map((segment) => ({
    lineageId: segment.id,
    performerId,
    cycleId: 0,
    cycleStartDate: BALANCE.calendar.startDate,
    cycleEndDate: addDays(BALANCE.calendar.startDate, 27),
    allocatedJpy: "0",
    remainingJpy: "0",
    newViewerCount: 0,
    initialized: false,
  }));
}

function activeEstimateForSegment(segment) {
  const recent = (segment.dailyReachEstimates || []).slice(-28);
  if (!recent.length || !segment.knownViewers) return 0;
  const coverage = 1 - recent.reduce((product, item) => product * (1 - Math.min(item.unique / segment.knownViewers, 1)), 1);
  return Math.min(segment.knownViewers, Math.max(...recent.map((item) => item.unique), Math.round(segment.knownViewers * coverage)));
}

function cycleForDate(date) {
  const elapsed = Math.max(0, daysBetween(BALANCE.calendar.startDate, date));
  const cycleId = Math.floor(elapsed / BALANCE.calendar.budgetCycleDays);
  const cycleStartDate = addDays(BALANCE.calendar.startDate, cycleId * BALANCE.calendar.budgetCycleDays);
  return { cycleId, cycleStartDate, cycleEndDate: addDays(cycleStartDate, BALANCE.calendar.budgetCycleDays - 1) };
}

export function ensureAudienceBudgetCycle(state, date) {
  const cycle = cycleForDate(date);
  for (const segment of state.audienceSegments) {
    let budget = state.audienceBudgets.find((item) => item.lineageId === segment.id && item.performerId === state.performer.id);
    if (!budget) {
      budget = createAudienceBudgets([segment], state.performer.id)[0];
      state.audienceBudgets.push(budget);
    }
    if (!budget.initialized || budget.cycleId !== cycle.cycleId) {
      const tier = SUPPORT_TIERS[segment.spendTier];
      const participants = activeEstimateForSegment(segment);
      const allocated = Math.floor(participants * tier.perCapitaCycleBudgetJpy * (0.2 + 0.2 * segment.loyalty / 100));
      Object.assign(budget, {
        ...cycle,
        allocatedJpy: String(allocated),
        remainingJpy: String(allocated),
        newViewerCount: 0,
        initialized: true,
      });
    }
  }
}

export function allocateNewViewerBudget(state, segment, budget, newViewers, date) {
  if (!newViewers || segment.spendTier === "none") return 0n;
  const tier = SUPPORT_TIERS[segment.spendTier];
  const remainingDays = Math.max(1, daysBetween(date, budget.cycleEndDate) + 1);
  const perViewer = tier.perCapitaCycleBudgetJpy * (0.2 + 0.2 * segment.loyalty / 100);
  const increment = BigInt(Math.floor(newViewers * perViewer * remainingDays / BALANCE.calendar.budgetCycleDays));
  addMoney(budget, "allocatedJpy", increment);
  addMoney(budget, "remainingJpy", increment);
  budget.newViewerCount += newViewers;
  return increment;
}

function spendBudget(budget, requestedJpy) {
  const requested = BigInt(requestedJpy);
  const remaining = BigInt(budget.remainingJpy);
  if (requested > remaining) return false;
  budget.remainingJpy = String(remaining - requested);
  return true;
}

function denominationForDraw(tier, draw, remainingJpy) {
  const probabilities = SC_DENOMINATIONS[tier];
  let point = Math.floor(draw * 10000);
  let selected = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    point -= probabilities[index];
    if (point < 0) { selected = SC_DENOMINATIONS.amountsJpy[index]; break; }
  }
  if (selected <= remainingJpy) return selected;
  return [...SC_DENOMINATIONS.amountsJpy].reverse().find((amount) => amount <= remainingJpy) || 0;
}

function pushJournal(state, entry) {
  const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n);
  const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n);
  if (debit !== credit) throw new Error("INVALID_FINANCIAL_BASIS");
  state.history.journalEntries.push(entry);
}

function platformDelayDays(state) {
  return state.routeId === "indie" ? 28 : 42;
}

export function recordPlatformRevenue(state, { id, sourceId, type, grossJpy, date }) {
  const creatorShareBps = ROUTES[state.routeId].creatorShareBps;
  const waterfall = calculateScWaterfall({ grossJpy, creatorShareBps });
  const creatorEarned = BigInt(waterfall.creatorEarnedJpy);
  const dueDate = addDays(date, platformDelayDays(state));
  const transaction = { id, sourceId, type, date, grossJpy: String(grossJpy), ...waterfall, contractId: state.contract?.id || null, creatorShareBps, dueDate };
  state.history.platformTransactions.push(transaction);
  addMoney(state.cash, "receivable", creatorEarned);
  if (type === "SC") {
    addMoney(state.finance, "scGrossLifetime", grossJpy);
    addMoney(state.finance, "scChannelNet", waterfall.channelNetJpy);
    addMoney(state.finance, "scCreatorEarned", creatorEarned);
  } else if (type === "MEMBERSHIP") {
    addMoney(state.finance, "membershipGrossLifetime", grossJpy);
    addMoney(state.finance, "membershipChannelNet", waterfall.channelNetJpy);
    addMoney(state.finance, "membershipCreatorEarned", creatorEarned);
  }
  const receivable = { id: `receivable_${id}`, originalTransactionId: id, type, debtor: state.routeId === "indie" ? "PLATFORM" : ROUTES[state.routeId].agencyId, amountJpy: String(creatorEarned), receivedJpy: "0", adjustedJpy: "0", dueDate, status: "OPEN", contractId: state.contract?.id || null };
  state.history.receivables.push(receivable);
  pushJournal(state, {
    id: `journal_${id}`,
    date,
    sourceId: id,
    originalTransactionId: id,
    lines: [
      { account: "RECEIVABLE", debit: String(creatorEarned), credit: "0", contractId: state.contract?.id || null },
      { account: type, debit: "0", credit: String(creatorEarned), contractId: state.contract?.id || null },
    ],
  });
  return transaction;
}

export function processDueReceivables(state, date) {
  let received = 0n;
  for (const receivable of state.history.receivables) {
    if (receivable.status !== "OPEN" || compareIso(receivable.dueDate, date) > 0) continue;
    const amount = BigInt(receivable.amountJpy) - BigInt(receivable.receivedJpy) - BigInt(receivable.adjustedJpy || 0);
    if (amount <= 0n) continue;
    receivable.receivedJpy = receivable.amountJpy;
    receivable.status = "RECEIVED";
    addMoney(state.cash, "free", amount);
    state.cash.receivable = String(BigInt(state.cash.receivable) - amount);
    if (receivable.type === "SC") addMoney(state.finance, "scCreatorReceived", amount);
    if (receivable.type === "MEMBERSHIP") addMoney(state.finance, "membershipCreatorReceived", amount);
    if (receivable.type === "ADS") addMoney(state.finance, "adsCreatorReceived", amount);
    if (receivable.type === "SPONSOR") addMoney(state.finance, "sponsorCreatorReceived", amount);
    if (receivable.type === "ROYALTY") addMoney(state.finance, "royaltyCreatorReceived", amount);
    pushJournal(state, {
      id: `journal_receive_${receivable.id}`,
      date,
      sourceId: receivable.id,
      originalTransactionId: receivable.originalTransactionId,
      lines: [
        { account: "CASH_FREE", debit: String(amount), credit: "0", contractId: receivable.contractId },
        { account: "RECEIVABLE", debit: "0", credit: String(amount), contractId: receivable.contractId },
      ],
    });
    received += amount;
  }
  return received;
}

export function recordAdsForContent(state, content) {
  if (state.channel.adsStatus !== "APPROVED" || state.channel.adsFeatureEnabled !== true || content.visibility !== "PUBLIC") return { channelNetJpy: "0", creatorEarnedJpy: "0", reason: "PLATFORM_FEATURE_UNAVAILABLE" };
  const rpm = content.type === "SHORT" ? 5 : 200;
  const validViews = Math.max(0, Math.floor(content.uniqueEstimate || 0));
  const channelNet = BigInt(Math.floor(validViews * rpm / 1000));
  if (channelNet === 0n) return { channelNetJpy: "0", creatorEarnedJpy: "0", reason: "BELOW_INTEGER_YEN" };
  const creatorShareBps = ROUTES[state.routeId].creatorShareBps;
  const creatorEarned = channelNet * BigInt(creatorShareBps) / 10000n;
  const id = `ads_${content.id}`;
  const dueDate = addDays(content.publishedAt, platformDelayDays(state));
  const transaction = {
    id,
    sourceId: content.id,
    type: "ADS",
    date: content.publishedAt,
    validViews,
    rpmJpy: String(rpm),
    grossJpy: String(channelNet),
    basisJpy: String(channelNet),
    channelNetJpy: String(channelNet),
    creatorEarnedJpy: String(creatorEarned),
    companyEarnedJpy: String(channelNet - creatorEarned),
    contractId: state.contract?.id || null,
    creatorShareBps,
    dueDate,
  };
  state.history.platformTransactions.push(transaction);
  addMoney(state.cash, "receivable", creatorEarned);
  addMoney(state.finance, "adsChannelNet", channelNet);
  addMoney(state.finance, "adsCreatorEarned", creatorEarned);
  state.history.receivables.push({ id: `receivable_${id}`, originalTransactionId: id, type: "ADS", debtor: state.routeId === "indie" ? "PLATFORM" : ROUTES[state.routeId].agencyId, amountJpy: String(creatorEarned), receivedJpy: "0", adjustedJpy: "0", dueDate, status: "OPEN", contractId: state.contract?.id || null });
  pushJournal(state, {
    id: `journal_${id}`,
    date: content.publishedAt,
    sourceId: id,
    originalTransactionId: id,
    lines: [
      { account: "RECEIVABLE", debit: String(creatorEarned), credit: "0", contractId: state.contract?.id || null },
      { account: "ADS", debit: "0", credit: String(creatorEarned), contractId: state.contract?.id || null },
    ],
  });
  return { channelNetJpy: String(channelNet), creatorEarnedJpy: String(creatorEarned), validViews, rpmJpy: String(rpm), reason: null };
}

export function refundScTransaction(state, { id, originalTransactionId, cumulativeRefundJpy, date }) {
  if (state.history.refundTransactions.some((refund) => refund.id === id)) return state.history.refundTransactions.find((refund) => refund.id === id);
  const original = state.history.platformTransactions.find((transaction) => transaction.id === originalTransactionId && transaction.type === "SC");
  if (!original) throw new Error("INVALID_FINANCIAL_BASIS");
  const cumulative = asMoney(cumulativeRefundJpy);
  const gross = BigInt(original.grossJpy);
  if (cumulative > gross) throw new Error("INVALID_FINANCIAL_BASIS");
  const previousRefunds = state.history.refundTransactions.filter((refund) => refund.originalTransactionId === originalTransactionId).reduce((maximum, refund) => {
    const value = BigInt(refund.cumulativeRefundJpy);
    return value > maximum ? value : maximum;
  }, 0n);
  if (cumulative < previousRefunds) throw new Error("INVALID_FINANCIAL_BASIS");
  const previous = calculateScWaterfall({ grossJpy: original.grossJpy, refundsJpy: String(previousRefunds), creatorShareBps: original.creatorShareBps });
  const revised = calculateScWaterfall({ grossJpy: original.grossJpy, refundsJpy: String(cumulative), creatorShareBps: original.creatorShareBps });
  const grossIncrement = cumulative - previousRefunds;
  const channelDelta = BigInt(previous.channelNetJpy) - BigInt(revised.channelNetJpy);
  const creatorDelta = BigInt(previous.creatorEarnedJpy) - BigInt(revised.creatorEarnedJpy);
  const receivable = state.history.receivables.find((item) => item.originalTransactionId === originalTransactionId);
  const outstanding = receivable ? BigInt(receivable.amountJpy) - BigInt(receivable.receivedJpy) - BigInt(receivable.adjustedJpy || 0) : 0n;
  const receivableReduction = creatorDelta < outstanding ? creatorDelta : outstanding;
  if (receivable && receivableReduction > 0n) {
    receivable.adjustedJpy = String(BigInt(receivable.adjustedJpy || 0) + receivableReduction);
    const remaining = BigInt(receivable.amountJpy) - BigInt(receivable.receivedJpy) - BigInt(receivable.adjustedJpy);
    if (remaining === 0n) receivable.status = BigInt(receivable.receivedJpy) > 0n ? "RECEIVED" : "CANCELLED_BY_REFUND";
    state.cash.receivable = String(BigInt(state.cash.receivable) - receivableReduction);
  }
  const cashRequired = creatorDelta - receivableReduction;
  const cashPaid = cashRequired < BigInt(state.cash.free) ? cashRequired : BigInt(state.cash.free);
  const payableCreated = cashRequired - cashPaid;
  if (cashPaid > 0n) {
    state.cash.free = String(BigInt(state.cash.free) - cashPaid);
    state.finance.scCreatorReceived = String(BigInt(state.finance.scCreatorReceived) - cashPaid);
  }
  if (payableCreated > 0n) {
    addMoney(state.cash, "payable", payableCreated);
    addMoney(state.liabilities, "refundPayable", payableCreated);
  }
  state.finance.scRefundsLifetime = String(BigInt(state.finance.scRefundsLifetime) + grossIncrement);
  state.finance.scChannelNet = String(BigInt(state.finance.scChannelNet) - channelDelta);
  state.finance.scCreatorEarned = String(BigInt(state.finance.scCreatorEarned) - creatorDelta);
  const refund = {
    id,
    originalTransactionId,
    date,
    cumulativeRefundJpy: String(cumulative),
    refundIncrementJpy: String(grossIncrement),
    channelNetReductionJpy: String(channelDelta),
    creatorReductionJpy: String(creatorDelta),
    receivableReductionJpy: String(receivableReduction),
    cashPaidJpy: String(cashPaid),
    payableCreatedJpy: String(payableCreated),
  };
  state.history.refundTransactions.push(refund);
  pushJournal(state, {
    id: `journal_${id}`,
    date,
    sourceId: id,
    originalTransactionId,
    lines: [
      { account: "REFUND_CONTRA_REVENUE", debit: String(creatorDelta), credit: "0", contractId: original.contractId },
      ...(receivableReduction > 0n ? [{ account: "RECEIVABLE", debit: "0", credit: String(receivableReduction), contractId: original.contractId }] : []),
      ...(cashPaid > 0n ? [{ account: "CASH_FREE", debit: "0", credit: String(cashPaid), contractId: original.contractId }] : []),
      ...(payableCreated > 0n ? [{ account: "REFUND_PAYABLE", debit: "0", credit: String(payableCreated), contractId: original.contractId }] : []),
    ],
  });
  return refund;
}

export async function generateScForLive(state, content, segmentSnapshots, slotIndex) {
  if (!canReceiveSc(state.channel, content).allowed) return { grossJpy: "0", creatorEarnedJpy: "0", paymentCount: 0, reason: "PLATFORM_FEATURE_UNAVAILABLE" };
  let gross = 0n;
  let paymentCount = 0;
  let contributingSegments = 0;
  for (const snapshot of segmentSnapshots) {
    const segment = state.audienceSegments.find((item) => item.id === snapshot.segmentId);
    if (!segment || segment.spendTier === "none") continue;
    const budget = state.audienceBudgets.find((item) => item.lineageId === segment.id && item.performerId === state.performer.id);
    const tier = SUPPORT_TIERS[segment.spendTier];
    const expected = snapshot.unique * tier.baseScPaymentRate * (0.5 + content.quality / 100) * (0.6 + snapshot.loyalty / 100);
    const baseCount = Math.floor(expected);
    const fraction = expected - baseCount;
    const countDraw = await deterministicRandom(state.seed, state.weekIndex, "sc_count", `${content.id}_${segment.id}`, slotIndex);
    const candidateCount = baseCount + (countDraw < fraction ? 1 : 0);
    const denominationDraws = await Promise.all(Array.from({ length: candidateCount }, (_, paymentIndex) => deterministicRandom(state.seed, state.weekIndex, "sc_denomination", `${content.id}_${segment.id}`, paymentIndex)));
    let segmentGross = 0n;
    let segmentPayments = 0;
    for (const draw of denominationDraws) {
      const amount = denominationForDraw(segment.spendTier, draw, Number(budget.remainingJpy));
      if (!amount || !spendBudget(budget, amount)) continue;
      segmentGross += BigInt(amount);
      segmentPayments += 1;
    }
    if (segmentGross > 0n) {
      gross += segmentGross;
      paymentCount += segmentPayments;
      contributingSegments += 1;
    }
  }
  if (gross === 0n) return { grossJpy: "0", creatorEarnedJpy: "0", paymentCount: 0, reason: "NO_BUDGETED_PAYMENTS" };
  // The simulation is segment-based but the auditable financial occurrence is the
  // live itself. Store one settlement for it, never pseudo-records for simulated people.
  const transaction = recordPlatformRevenue(state, { id: `sc_${content.id}`, sourceId: content.id, type: "SC", grossJpy: String(gross), date: content.publishedAt });
  transaction.paymentCount = paymentCount;
  transaction.contributingSegments = contributingSegments;
  transaction.aggregation = "CONTENT";
  return { grossJpy: String(gross), creatorEarnedJpy: transaction.creatorEarnedJpy, paymentCount, reason: null };
}

export async function generateMembershipsForLive(state, content, segmentSnapshots, slotIndex) {
  if (state.channel.fanFundingStatus !== "APPROVED" || state.channel.membershipFeatureEnabled !== true) return { grossJpy: "0", creatorEarnedJpy: "0", joined: 0, reason: "PLATFORM_FEATURE_UNAVAILABLE" };
  if (state.membershipProgram.chargesPaused) return { grossJpy: "0", creatorEarnedJpy: "0", joined: 0, reason: "CHARGES_PAUSED" };
  let gross = 0n;
  let joined = 0;
  const createdBatches = [];
  for (const snapshot of segmentSnapshots) {
    const segment = state.audienceSegments.find((item) => item.id === snapshot.segmentId);
    if (!segment || segment.spendTier === "none") continue;
    const budget = state.audienceBudgets.find((item) => item.lineageId === segment.id && item.performerId === state.performer.id);
    const activeMembers = state.history.membershipBatches.filter((batch) => batch.segmentId === segment.id && batch.channelId === state.channel.id && batch.status === "ACTIVE").reduce((sum, batch) => sum + batch.count, 0);
    const eligibleViewers = Math.max(0, snapshot.unique - activeMembers);
    const probability = Math.min(0.03, 0.002 + 0.015 * snapshot.loyalty / 100 + 0.008 * state.membershipProgram.recentFulfillment);
    const expected = eligibleViewers * probability;
    const baseCount = Math.floor(expected);
    const draw = await deterministicRandom(state.seed, state.weekIndex, "membership_join", `${content.id}_${segment.id}`, slotIndex);
    const requested = Math.min(eligibleViewers, baseCount + (draw < expected - baseCount ? 1 : 0));
    const affordable = Math.min(requested, Math.floor(Number(budget.remainingJpy) / 500));
    if (!affordable) continue;
    const amount = affordable * 500;
    spendBudget(budget, amount);
    const promise = ensureMembershipPromise(state, content.publishedAt);
    const batchId = `member_w${state.weekIndex}_s${slotIndex}_${segment.id}`;
    const batch = { id: batchId, channelId: state.channel.id, segmentId: segment.id, type: "PAID", count: affordable, priceJpy: String(BALANCE.membership.priceJpy), startedAt: content.publishedAt, expiresAt: addDays(content.publishedAt, BALANCE.membership.cycleDays), payerSegmentId: segment.id, status: "ACTIVE", promiseId: promise.id, benefitFulfillment: 0, unfulfilledPromises: 0, transactionId: null };
    state.history.membershipBatches.push(batch);
    createdBatches.push(batch);
    gross += BigInt(amount);
    joined += affordable;
  }
  if (gross === 0n) return { grossJpy: "0", creatorEarnedJpy: "0", joined: 0, reason: "NO_BUDGETED_JOINS" };
  const transaction = recordPlatformRevenue(state, { id: `membership_${content.id}`, sourceId: content.id, type: "MEMBERSHIP", grossJpy: String(gross), date: content.publishedAt });
  transaction.memberCount = joined;
  transaction.aggregation = "CONTENT";
  for (const batch of createdBatches) batch.transactionId = transaction.id;
  return { grossJpy: String(gross), creatorEarnedJpy: transaction.creatorEarnedJpy, joined };
}

export async function processMembershipExpiries(state, date) {
  const expiring = state.history.membershipBatches.filter((batch) => batch.status === "ACTIVE" && compareIso(batch.expiresAt, date) <= 0);
  let renewed = 0;
  let gross = 0n;
  const renewalBatches = [];
  for (const batch of expiring) {
    if (batch.status !== "ACTIVE" || compareIso(batch.expiresAt, date) > 0) continue;
    batch.status = "EXPIRED";
    // Gifted membership never becomes a paid authorization implicitly.
    if (batch.type === "GIFTED") continue;
    const promise = state.history.membershipPromises.find((item) => item.id === batch.promiseId);
    if (promise) {
      batch.benefitFulfillment = promise.requiredUnits ? promise.fulfilledUnits / promise.requiredUnits : 1;
      batch.unfulfilledPromises = Math.max(0, promise.requiredUnits - promise.fulfilledUnits);
    }
    if (state.membershipProgram.chargesPaused) continue;
    const segment = state.audienceSegments.find((item) => item.id === batch.segmentId);
    const budget = state.audienceBudgets.find((item) => item.lineageId === batch.segmentId && item.performerId === state.performer.id);
    if (!segment || !budget) continue;
    const probability = membershipRenewalProbability({ loyalty: segment.loyalty, benefitFulfillment: batch.benefitFulfillment ?? 1, unfulfilledPromises: batch.unfulfilledPromises || 0 });
    const expected = batch.count * probability;
    const baseCount = Math.floor(expected);
    const draw = await deterministicRandom(state.seed, state.weekIndex, "membership_renew", batch.id, daysBetween(BALANCE.calendar.startDate, date));
    const requested = baseCount + (draw < expected - baseCount ? 1 : 0);
    const affordable = Math.min(requested, Math.floor(Number(budget.remainingJpy) / Number(batch.priceJpy)));
    if (!affordable) continue;
    const amount = affordable * Number(batch.priceJpy);
    spendBudget(budget, amount);
    const nextPromise = ensureMembershipPromise(state, date);
    const renewalId = `${batch.id}_renew_${date}`;
    const renewalBatch = {
      ...batch,
      id: renewalId,
      count: affordable,
      startedAt: date,
      expiresAt: addDays(date, 28),
      status: "ACTIVE",
      renewedFromBatchId: batch.id,
      promiseId: nextPromise.id,
      benefitFulfillment: 0,
      unfulfilledPromises: 0,
      transactionId: null,
    };
    state.history.membershipBatches.push(renewalBatch);
    renewalBatches.push(renewalBatch);
    renewed += affordable;
    gross += BigInt(amount);
  }
  if (gross > 0n) {
    const transaction = recordPlatformRevenue(state, { id: `membership_renew_${state.channel.id}_${date}`, sourceId: `membership_renewal_${date}`, type: "MEMBERSHIP", grossJpy: String(gross), date });
    transaction.memberCount = renewed;
    transaction.aggregation = "RENEWAL_DATE";
    for (const batch of renewalBatches) batch.transactionId = transaction.id;
  }
  return { renewed, grossJpy: String(gross) };
}

export function processPlatformReview(state, date) {
  let changed = false;
  if (state.channel.fanFundingStatus === "UNDER_REVIEW" && state.channel.fanFundingReviewDueDate && compareIso(state.channel.fanFundingReviewDueDate, date) <= 0) {
    const eligibility = fanFundingEligibility(state.channel);
    if (eligibility.eligible && state.channel.commerceTermsAccepted) {
      state.channel.fanFundingStatus = "APPROVED";
      state.channel.scFeatureEnabled = true;
      state.channel.membershipFeatureEnabled = true;
      state.channel.fanFundingApprovedAt = date;
    } else {
      state.channel.fanFundingStatus = "REJECTED";
      state.channel.fanFundingReviewReason = "REQUIREMENTS_CHANGED";
    }
    changed = true;
  }
  if (state.channel.adsStatus === "UNDER_REVIEW" && state.channel.adsReviewDueDate && compareIso(state.channel.adsReviewDueDate, date) <= 0) {
    if (adsEligibility(state.channel).eligible) {
      state.channel.adsStatus = "APPROVED";
      state.channel.adsFeatureEnabled = true;
      state.channel.adsApprovedAt = date;
    } else {
      state.channel.adsStatus = "REJECTED";
      state.channel.adsReviewReason = "REQUIREMENTS_CHANGED";
    }
    changed = true;
  }
  return changed;
}

export function applyForFanFunding(sourceState, date) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段提交收益化申请" };
  if (sourceState.channel.fanFundingStatus === "UNDER_REVIEW") return { ok: false, code: "INVALID_PHASE", message: "收益化申请正在审核中" };
  const eligibility = fanFundingEligibility(sourceState.channel);
  if (!eligibility.eligible) return { ok: false, code: "PLATFORM_FEATURE_UNAVAILABLE", message: "数字门槛尚未全部满足", details: eligibility.checks };
  const state = structuredClone(sourceState);
  state.channel.fanFundingStatus = "UNDER_REVIEW";
  state.channel.commerceTermsAccepted = true;
  state.channel.fanFundingAppliedAt = date;
  state.channel.fanFundingReviewDueDate = addDays(date, PLATFORM_RULES.fanFunding.reviewDays);
  state.snapshotVersion += 1;
  return { ok: true, state };
}

export function applyForAds(sourceState, date) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段提交广告收益申请" };
  if (sourceState.channel.adsStatus === "UNDER_REVIEW") return { ok: false, code: "INVALID_PHASE", message: "广告收益申请正在审核中" };
  const eligibility = adsEligibility(sourceState.channel);
  if (!eligibility.eligible) return { ok: false, code: "PLATFORM_FEATURE_UNAVAILABLE", message: "广告收益数字门槛尚未全部满足", details: eligibility.checks };
  const state = structuredClone(sourceState);
  state.channel.adsStatus = "UNDER_REVIEW";
  state.channel.adsAppliedAt = date;
  state.channel.adsReviewDueDate = addDays(date, PLATFORM_RULES.fanFunding.reviewDays);
  state.snapshotVersion += 1;
  return { ok: true, state };
}
