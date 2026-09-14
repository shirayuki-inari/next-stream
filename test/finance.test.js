import test from "node:test";
import assert from "node:assert/strict";
import { createGame, migrateGame, settleWeek, updatePlan } from "../src/domain/engine.js";
import {
  adsEligibility,
  allocateNewViewerBudget,
  applyForAds,
  applyForFanFunding,
  calculateScWaterfall,
  canReceiveSc,
  ensureAudienceBudgetCycle,
  fanFundingEligibility,
  generateMembershipsForLive,
  generateScForLive,
  membershipRenewalProbability,
  payRefundPayable,
  processDueReceivables,
  processMembershipExpiries,
  processMembershipPromiseDeadlines,
  processPlatformReview,
  recalculateEligibilityWindows,
  recordAdsForContent,
  recordPlatformRevenue,
  refundScTransaction,
  setMembershipPolicy,
} from "../src/domain/finance.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game(routeId = "indie", seed = "finance-seed") {
  return migrateGame(createGame({ mode: "direct", routeId, performerCode: "FIN", characterName: "账房信号", primaryLanguage: "jp", primaryDirection: "game", careerGoal: "livelihood", seed, abilities }));
}

test("G-01 SC waterfall preserves each integer-yen layer", () => {
  assert.deepEqual(calculateScWaterfall({ grossJpy: "100000", refundsJpy: "0", adjustmentsJpy: "10000", creatorShareBps: 6000 }), {
    basisJpy: "90000",
    channelNetJpy: "63000",
    creatorEarnedJpy: "37800",
    companyEarnedJpy: "25200",
  });
});

test("G-02 indie SC becomes receivable without increasing free cash", () => {
  const state = game("indie", "g02");
  recordPlatformRevenue(state, { id: "sc_g02", sourceId: "content_g02", type: "SC", grossJpy: "18000", date: "2026-09-14" });
  assert.equal(state.cash.free, "600000");
  assert.equal(state.cash.receivable, "12600");
  assert.equal(state.finance.scCreatorEarned, "12600");
  assert.equal(state.history.receivables[0].dueDate, "2026-10-12");
});

test("G-12 three yen remain conserved across platform and corporate share", () => {
  assert.deepEqual(calculateScWaterfall({ grossJpy: "3", creatorShareBps: 6000 }), {
    basisJpy: "3",
    channelNetJpy: "2",
    creatorEarnedJpy: "1",
    companyEarnedJpy: "1",
  });
});

test("A-11 subscriber threshold alone cannot unlock fan funding", () => {
  const state = game();
  state.channel.subscribers = 500;
  const eligibility = fanFundingEligibility(state.channel);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.checks.subscribers, true);
  assert.equal(eligibility.checks.publicUploads, false);
  assert.equal(eligibility.checks.watchOrShorts, false);
});

test("A-12 review status cannot receive SC and approves only on its due day", () => {
  const state = game();
  Object.assign(state.channel, { subscribers: 500, validPublicUploads90d: 3, validWatchMinutes12m: 180000, fanFundingStatus: "ELIGIBLE_TO_APPLY" });
  const applied = applyForFanFunding(state, "2026-09-14");
  assert.equal(applied.ok, true);
  const content = { type: "LIVE", visibility: "PUBLIC", liveChatEnabled: true };
  assert.equal(canReceiveSc(applied.state.channel, content).allowed, false);
  assert.equal(processPlatformReview(applied.state, "2026-09-20"), false);
  assert.equal(applied.state.channel.fanFundingStatus, "UNDER_REVIEW");
  assert.equal(processPlatformReview(applied.state, "2026-09-21"), true);
  assert.equal(applied.state.channel.fanFundingStatus, "APPROVED");
  assert.equal(canReceiveSc(applied.state.channel, content).allowed, true);
});

test("A-13 private or chat-disabled live produces a specific failed SC check", () => {
  const state = game();
  Object.assign(state.channel, { fanFundingStatus: "APPROVED", commerceTermsAccepted: true, scFeatureEnabled: true });
  const privateResult = canReceiveSc(state.channel, { type: "LIVE", visibility: "PRIVATE", liveChatEnabled: true });
  const chatResult = canReceiveSc(state.channel, { type: "LIVE", visibility: "PUBLIC", liveChatEnabled: false });
  assert.equal(privateResult.allowed, false);
  assert.equal(privateResult.checks.public, false);
  assert.equal(chatResult.allowed, false);
  assert.equal(chatResult.checks.liveChatEnabled, false);
});

test("A-17 SC and membership share one non-negative audience budget", async () => {
  const state = game("indie", "shared-budget");
  Object.assign(state.channel, { fanFundingStatus: "APPROVED", commerceTermsAccepted: true, scFeatureEnabled: true, membershipFeatureEnabled: true });
  ensureAudienceBudgetCycle(state, "2026-09-14");
  const segment = state.audienceSegments.find((item) => item.spendTier === "light");
  const budget = state.audienceBudgets.find((item) => item.lineageId === segment.id);
  allocateNewViewerBudget(state, segment, budget, 1000, "2026-09-14");
  const initial = BigInt(budget.remainingJpy);
  const content = { id: "content_budget", type: "LIVE", visibility: "PUBLIC", liveChatEnabled: true, ageRestricted: false, madeForKids: false, usesGivingFundraiser: false, quality: 70, publishedAt: "2026-09-14" };
  const snapshots = [{ segmentId: segment.id, unique: 1000, newViewers: 1000, returning: 0, loyalty: 50 }];
  await generateScForLive(state, content, snapshots, 0);
  await generateMembershipsForLive(state, content, snapshots, 0);
  const remaining = BigInt(budget.remainingJpy);
  const spent = state.history.platformTransactions.reduce((sum, transaction) => sum + BigInt(transaction.grossJpy), 0n);
  assert.ok(remaining >= 0n);
  assert.equal(initial - remaining, spent);
  assert.ok(spent <= initial);
});

test("A-19 identity and affiliation changes cannot refresh an existing audience lineage budget", () => {
  const state = game("homolive", "audience-lineage-transfer");
  ensureAudienceBudgetCycle(state, "2026-09-14");
  const segment = state.audienceSegments.find((item) => item.spendTier === "light");
  const budget = state.audienceBudgets.find((item) => item.lineageId === segment.id && item.performerId === state.performer.id);
  allocateNewViewerBudget(state, segment, budget, 120, "2026-09-14");
  budget.remainingJpy = String(BigInt(budget.remainingJpy) - 500n);
  const before = { ...budget };
  const budgetCount = state.audienceBudgets.length;

  state.character.id = "character_after_transfer";
  state.channel.id = "channel_after_transfer";
  state.channel.characterId = state.character.id;
  state.affiliation.id = "affiliation_after_transfer";
  state.affiliation.agencyId = "agency_after_transfer";
  ensureAudienceBudgetCycle(state, "2026-09-14");

  assert.equal(state.audienceBudgets.length, budgetCount);
  const inherited = state.audienceBudgets.find((item) => item.lineageId === segment.id && item.performerId === state.performer.id);
  assert.equal(inherited.allocatedJpy, before.allocatedJpy);
  assert.equal(inherited.remainingJpy, before.remainingJpy);
  assert.equal(inherited.cycleId, before.cycleId);
});

test("A-18 gifted membership expires without converting to paid membership", async () => {
  const state = game();
  state.history.membershipBatches.push({ id: "gifted", channelId: state.channel.id, segmentId: "seg_jp_game_light", type: "GIFTED", count: 5, startedAt: "2026-09-14", expiresAt: "2026-10-12", status: "ACTIVE" });
  await processMembershipExpiries(state, "2026-10-12");
  assert.equal(state.history.membershipBatches.length, 1);
  assert.equal(state.history.membershipBatches[0].status, "EXPIRED");
  assert.equal(state.history.platformTransactions.length, 0);
});

test("paid membership renewal uses the refreshed shared budget and creates a new batch", async () => {
  const state = game("indie", "renew-membership");
  Object.assign(state.channel, { fanFundingStatus: "APPROVED", commerceTermsAccepted: true, membershipFeatureEnabled: true });
  const segment = state.audienceSegments.find((item) => item.spendTier === "light");
  segment.knownViewers = 100;
  segment.loyalty = 80;
  segment.dailyReachEstimates.push({ date: "2026-10-11", unique: 100 });
  ensureAudienceBudgetCycle(state, "2026-10-12");
  state.history.membershipBatches.push({ id: "paid_original", channelId: state.channel.id, segmentId: segment.id, type: "PAID", count: 10, priceJpy: "500", startedAt: "2026-09-14", expiresAt: "2026-10-12", status: "ACTIVE", benefitFulfillment: 1 });
  const result = await processMembershipExpiries(state, "2026-10-12");
  assert.ok(result.renewed > 0);
  assert.equal(state.history.membershipBatches[0].status, "EXPIRED");
  assert.equal(state.history.membershipBatches[1].status, "ACTIVE");
  assert.equal(state.history.membershipBatches[1].renewedFromBatchId, "paid_original");
  assert.ok(BigInt(state.audienceBudgets.find((item) => item.lineageId === segment.id).remainingJpy) >= 0n);
});

test("approved end-to-end live creates budgeted commerce and balanced journals", async () => {
  let state = game("homolive", "approved-live");
  Object.assign(state.channel, { fanFundingStatus: "APPROVED", commerceTermsAccepted: true, scFeatureEnabled: true, membershipFeatureEnabled: true });
  state = updatePlan(state, 0, "LIVE_GAME").state;
  const result = await settleWeek(state);
  assert.equal(result.ok, true);
  assert.ok(BigInt(result.state.finance.scGrossLifetime) > 0n);
  assert.ok(BigInt(result.state.cash.receivable) > 0n);
  assert.ok(result.state.history.membershipBatches.length > 0);
  for (const entry of result.state.history.journalEntries) {
    const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n);
    const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n);
    assert.equal(debit, credit, entry.id);
  }
});

test("A-26 repeated partial SC refunds use cumulative recomputation without negative receivable", () => {
  const state = game("indie", "partial-refunds");
  recordPlatformRevenue(state, { id: "sc_original", sourceId: "content_refund", type: "SC", grossJpy: "1000", date: "2026-09-14" });
  refundScTransaction(state, { id: "refund_1", originalTransactionId: "sc_original", cumulativeRefundJpy: "333", date: "2026-09-15" });
  refundScTransaction(state, { id: "refund_2", originalTransactionId: "sc_original", cumulativeRefundJpy: "666", date: "2026-09-16" });
  refundScTransaction(state, { id: "refund_3", originalTransactionId: "sc_original", cumulativeRefundJpy: "1000", date: "2026-09-17" });
  assert.equal(state.finance.scRefundsLifetime, "1000");
  assert.equal(state.finance.scChannelNet, "0");
  assert.equal(state.finance.scCreatorEarned, "0");
  assert.equal(state.cash.receivable, "0");
  assert.equal(state.history.receivables[0].adjustedJpy, "700");
  assert.equal(state.history.receivables[0].status, "CANCELLED_BY_REFUND");
  for (const entry of state.history.journalEntries) {
    const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n);
    const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n);
    assert.equal(debit, credit, entry.id);
  }
});

test("fan funding and ads keep independent numerical thresholds and applications", () => {
  const state = game();
  Object.assign(state.channel, { subscribers: 600, validPublicUploads90d: 3, validWatchMinutes12m: 190000 });
  assert.equal(fanFundingEligibility(state.channel).eligible, true);
  assert.equal(adsEligibility(state.channel).eligible, false);
  const rejected = applyForAds(state, "2026-09-14");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "PLATFORM_FEATURE_UNAVAILABLE");
});

test("ads review approves independently and RPM is not charged another platform share", () => {
  const state = game("homolive", "ads-rpm");
  Object.assign(state.channel, { subscribers: 1000, validWatchMinutes12m: 240000, adsStatus: "ELIGIBLE_TO_APPLY" });
  const applied = applyForAds(state, "2026-09-14");
  assert.equal(applied.ok, true);
  assert.equal(applied.state.channel.fanFundingStatus, "INELIGIBLE");
  processPlatformReview(applied.state, "2026-09-21");
  assert.equal(applied.state.channel.adsStatus, "APPROVED");
  const result = recordAdsForContent(applied.state, { id: "video_ads", type: "VIDEO", visibility: "PUBLIC", uniqueEstimate: 10000, publishedAt: "2026-09-21" });
  assert.equal(result.channelNetJpy, "2000");
  assert.equal(result.creatorEarnedJpy, "1200");
  assert.equal(applied.state.cash.receivable, "1200");
});

test("A-14 Shorts never create SC but can earn their separate ads RPM", () => {
  const state = game("indie", "shorts-ads");
  Object.assign(state.channel, { fanFundingStatus: "APPROVED", commerceTermsAccepted: true, scFeatureEnabled: true, adsStatus: "APPROVED", adsFeatureEnabled: true });
  const short = { id: "short_ads", type: "SHORT", visibility: "PUBLIC", liveChatEnabled: true, uniqueEstimate: 2000, publishedAt: "2026-09-14" };
  assert.equal(canReceiveSc(state.channel, short).allowed, false);
  const ads = recordAdsForContent(state, short);
  assert.equal(ads.channelNetJpy, "10");
  assert.equal(ads.creatorEarnedJpy, "10");
});

test("A-15 private or deleted content leaves eligibility windows without deleting historical income", () => {
  const state = game("indie", "eligibility-recalc");
  state.history.contents.push(
    { id: "valid_video", type: "VIDEO", visibility: "PUBLIC", publishedAt: "2026-09-10", watchMinutes: 120000, uniqueEstimate: 1000 },
    { id: "private_short", type: "SHORT", visibility: "PRIVATE", publishedAt: "2026-09-11", watchMinutes: 0, uniqueEstimate: 4000000 },
    { id: "deleted_video", type: "VIDEO", visibility: "PUBLIC", deletedAt: "2026-09-12", publishedAt: "2026-09-12", watchMinutes: 90000, uniqueEstimate: 800 },
  );
  state.history.platformTransactions.push({ id: "historical_sc", grossJpy: "1000" });
  const metrics = recalculateEligibilityWindows(state, "2026-09-14");
  assert.equal(metrics.validPublicUploads90d, 1);
  assert.equal(metrics.validWatchMinutes12m, 120000);
  assert.equal(metrics.shortsViews90d, 0);
  assert.equal(state.history.platformTransactions.length, 1);

  state.history.contents[0].visibility = "PRIVATE";
  recalculateEligibilityWindows(state, "2026-09-14");
  assert.equal(state.channel.validPublicUploads90d, 0);
  assert.equal(state.channel.validWatchMinutes12m, 0);
  assert.equal(state.history.platformTransactions.length, 1);
});

test("A-16 rolling windows use exclusive lower and inclusive upper calendar boundaries", () => {
  const state = game("indie", "eligibility-boundary");
  state.history.contents.push(
    { id: "upload_outside", type: "SHORT", visibility: "PUBLIC", publishedAt: "2026-06-16", watchMinutes: 0, uniqueEstimate: 100 },
    { id: "upload_inside", type: "SHORT", visibility: "PUBLIC", publishedAt: "2026-06-17", watchMinutes: 0, uniqueEstimate: 200 },
    { id: "watch_outside", type: "LIVE", visibility: "PUBLIC", publishedAt: "2025-09-14", watchMinutes: 300, uniqueEstimate: 20 },
    { id: "watch_inside", type: "LIVE", visibility: "PUBLIC", publishedAt: "2025-09-15", watchMinutes: 500, uniqueEstimate: 30 },
    { id: "future", type: "VIDEO", visibility: "PUBLIC", publishedAt: "2026-09-15", watchMinutes: 900, uniqueEstimate: 50 },
  );
  const metrics = recalculateEligibilityWindows(state, "2026-09-14");
  assert.equal(metrics.ninetyDayLowerExclusive, "2026-06-16");
  assert.equal(metrics.twelveMonthLowerExclusive, "2025-09-14");
  assert.equal(metrics.validPublicUploads90d, 1);
  assert.equal(metrics.validWatchMinutes12m, 500);
  assert.equal(metrics.shortsViews90d, 200);
});

test("membership charges create one shared cycle promise and a targeted admin slot fulfills it", async () => {
  let state = game("indie", "membership-promise");
  Object.assign(state.channel, { fanFundingStatus: "APPROVED", membershipFeatureEnabled: true });
  ensureAudienceBudgetCycle(state, "2026-09-14");
  const segment = state.audienceSegments.find((item) => item.spendTier === "light");
  segment.knownViewers = 1000;
  segment.loyalty = 80;
  const budget = state.audienceBudgets.find((item) => item.lineageId === segment.id);
  allocateNewViewerBudget(state, segment, budget, 1000, "2026-09-14");
  const content = { id: "member_join_source", type: "LIVE", publishedAt: "2026-09-14" };
  const snapshots = [{ segmentId: segment.id, unique: 1000, newViewers: 1000, returning: 0, loyalty: 80 }];
  const joined = await generateMembershipsForLive(state, content, snapshots, 0);
  assert.ok(joined.joined > 0);
  assert.equal(state.history.membershipPromises.length, 1);
  const promise = state.history.membershipPromises[0];
  assert.deepEqual(promise.benefits, ["会员限定内容", "固定文字更新"]);
  assert.equal(state.history.membershipBatches.every((batch) => batch.promiseId === promise.id), true);

  const planned = updatePlan(state, 0, "BUSINESS_ADMIN", { targetId: promise.id, targetType: "MEMBERSHIP_PROMISE" });
  assert.equal(planned.ok, true);
  const settled = await settleWeek(planned.state);
  assert.equal(settled.ok, true);
  assert.equal(settled.state.history.membershipPromises[0].status, "FULFILLED");
  assert.equal(settled.report.commerce.membershipPromisesFulfilled, 1);
});

test("missed membership benefits become overdue and apply the specified renewal penalty", () => {
  const state = game("indie", "membership-overdue");
  state.history.membershipPromises.push({ id: "promise_due", channelId: state.channel.id, cycleId: "membership_cycle_1", startsAt: "2026-09-14", dueDate: "2026-10-11", policy: "STANDARD", requiredUnits: 2, fulfilledUnits: 1, benefits: ["会员限定内容", "固定文字更新"], status: "DUE" });
  assert.equal(processMembershipPromiseDeadlines(state, "2026-10-11").overdue, 0);
  assert.equal(processMembershipPromiseDeadlines(state, "2026-10-12").overdue, 1);
  assert.equal(state.history.membershipPromises[0].status, "OVERDUE");
  assert.equal(state.membershipProgram.recentFulfillment, 0.5);
  assert.equal(membershipRenewalProbability({ loyalty: 50, benefitFulfillment: 0.5, unfulfilledPromises: 1 }), 0.55);
});

test("light policy affects only future cycles and pausing charges blocks joins and renewals", async () => {
  let state = game("indie", "membership-policy");
  Object.assign(state.channel, { fanFundingStatus: "APPROVED", membershipFeatureEnabled: true });
  state.history.membershipPromises.push({ id: "existing_standard", channelId: state.channel.id, cycleId: "membership_cycle_1", startsAt: "2026-09-14", dueDate: "2026-10-11", policy: "STANDARD", requiredUnits: 2, fulfilledUnits: 0, benefits: ["会员限定内容", "固定文字更新"], status: "DUE" });
  const changed = setMembershipPolicy(state, { promisePolicy: "LIGHT", chargesPaused: true, date: "2026-09-21" });
  assert.equal(changed.ok, true);
  state = changed.state;
  assert.equal(state.history.membershipPromises[0].requiredUnits, 2);
  assert.equal(state.membershipProgram.promisePolicy, "LIGHT");

  ensureAudienceBudgetCycle(state, "2026-09-21");
  const segment = state.audienceSegments.find((item) => item.spendTier === "light");
  const budget = state.audienceBudgets.find((item) => item.lineageId === segment.id);
  allocateNewViewerBudget(state, segment, budget, 1000, "2026-09-21");
  const joined = await generateMembershipsForLive(state, { id: "paused", type: "LIVE", publishedAt: "2026-09-21" }, [{ segmentId: segment.id, unique: 1000, loyalty: 80 }], 0);
  assert.equal(joined.joined, 0);
  assert.equal(joined.reason, "CHARGES_PAUSED");
  state.history.membershipBatches.push({ id: "paid_paused", channelId: state.channel.id, segmentId: segment.id, type: "PAID", count: 10, priceJpy: "500", startedAt: "2026-08-24", expiresAt: "2026-09-21", status: "ACTIVE", benefitFulfillment: 1 });
  const renewed = await processMembershipExpiries(state, "2026-09-21");
  assert.equal(renewed.renewed, 0);
  assert.equal(state.history.membershipBatches.length, 1);
  assert.equal(state.history.membershipPromises[0].status, "DUE");
});

test("refund payable is separately tracked and can only be settled from free cash", () => {
  const state = game("indie", "refund-payable");
  recordPlatformRevenue(state, { id: "sc_received", sourceId: "content_refund_payable", type: "SC", grossJpy: "1000", date: "2026-09-14" });
  processDueReceivables(state, "2026-10-12");
  state.cash.free = "100";
  const refund = refundScTransaction(state, { id: "refund_payable_case", originalTransactionId: "sc_received", cumulativeRefundJpy: "1000", date: "2026-10-13" });
  assert.equal(refund.cashPaidJpy, "100");
  assert.equal(refund.payableCreatedJpy, "600");
  assert.equal(state.cash.payable, "600");
  assert.equal(state.liabilities.refundPayable, "600");

  state.cash.free = "250";
  const paid = payRefundPayable(state, { amountJpy: "250", date: "2026-10-14" });
  assert.equal(paid.ok, true);
  assert.equal(paid.state.cash.free, "0");
  assert.equal(paid.state.cash.payable, "350");
  assert.equal(paid.state.liabilities.refundPayable, "350");
  assert.equal(paid.state.finance.scCreatorReceived, "350");
  assert.equal(paid.state.history.payableSettlements.length, 1);
  const entry = paid.state.history.journalEntries.at(-1);
  assert.equal(entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n), entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n));
});

test("refund settlement rejects an inconsistent save before any balance can become negative", () => {
  const state = game("indie", "refund-inconsistent");
  state.cash.payable = "600";
  state.liabilities.refundPayable = "600";
  state.finance.scCreatorReceived = "0";
  const result = payRefundPayable(state, { amountJpy: "600", date: "2026-09-14" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_FINANCIAL_BASIS");
  assert.equal(state.cash.free, "600000");
  assert.equal(state.cash.payable, "600");
});
