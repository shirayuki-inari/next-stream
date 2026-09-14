import test from "node:test";
import assert from "node:assert/strict";
import { createGame, migrateGame, settleWeek, updatePlan } from "../src/domain/engine.js";
import { ensureAudienceBudgetCycle, processDueReceivables } from "../src/domain/finance.js";
import {
  beginMerchProduction,
  cancelMerchProject,
  closeMerchSales,
  confirmMerchProject,
  createMerchProject,
  merchBreakEvenUnits,
  openMerchSales,
  payMerchRefundPayable,
  processMerchProjectDate,
  recordMerchDesignWork,
  recordMerchPresale,
  refundDeliveredMerch,
  resolveUnderMoq,
  settleMerchProject,
  startMerchFulfillment,
} from "../src/domain/merch.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game(seed = "merch-seed") {
  return migrateGame(createGame({ mode: "direct", routeId: "indie", performerCode: "SHOP", characterName: "物贩信号", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed, abilities }));
}

function companyGame(seed = "company-merch-seed") {
  return migrateGame(createGame({ mode: "direct", routeId: "homolive", performerCode: "CORP", characterName: "会社信号", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed, abilities }));
}

function unwrap(result) {
  assert.equal(result.ok, true, result.message);
  return result.state;
}

function prepareSale(seed, knownViewers = 4000) {
  let state = game(seed);
  state = unwrap(createMerchProject(state, { date: "2026-09-14" }));
  const projectId = state.projects[0].id;
  state = unwrap(confirmMerchProject(state, { projectId, date: "2026-09-14" }));
  state = unwrap(recordMerchDesignWork(state, { projectId, date: "2026-09-14" }));
  state = unwrap(recordMerchDesignWork(state, { projectId, date: "2026-09-14" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-09-28" }));
  const segment = state.audienceSegments.find((item) => item.spendTier === "high");
  segment.knownViewers = knownViewers;
  segment.loyalty = 100;
  segment.dailyReachEstimates.push({ date: "2026-09-28", unique: knownViewers });
  ensureAudienceBudgetCycle(state, "2026-09-28");
  state = unwrap(openMerchSales(state, { projectId, date: "2026-09-28" }));
  return { state, projectId, lineageId: segment.id };
}

function prepareCompanySale(seed, knownViewers = 4000) {
  let state = companyGame(seed);
  state = unwrap(createMerchProject(state, { date: "2026-09-14", fundingModel: "COMPANY_LED" }));
  const projectId = state.projects[0].id;
  state = unwrap(confirmMerchProject(state, { projectId, date: "2026-09-14" }));
  state = unwrap(recordMerchDesignWork(state, { projectId, date: "2026-09-14" }));
  state = unwrap(recordMerchDesignWork(state, { projectId, date: "2026-09-14" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-09-28" }));
  const segment = state.audienceSegments.find((item) => item.spendTier === "high");
  segment.knownViewers = knownViewers;
  segment.loyalty = 100;
  segment.dailyReachEstimates.push({ date: "2026-09-28", unique: knownViewers });
  ensureAudienceBudgetCycle(state, "2026-09-28");
  state = unwrap(openMerchSales(state, { projectId, date: "2026-09-28" }));
  return { state, projectId, lineageId: segment.id };
}

function deliverPreparedSale(prepared, orders = 300) {
  let { state, projectId, lineageId } = prepared;
  state = unwrap(recordMerchPresale(state, { projectId, lineageId, requestedOrders: orders, date: "2026-09-28" }));
  state = unwrap(closeMerchSales(state, { projectId, date: "2026-10-11" }));
  state = unwrap(beginMerchProduction(state, { projectId, date: "2026-10-11" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-11-08" }));
  state = unwrap(startMerchFulfillment(state, { projectId, date: "2026-11-08" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-11-15" }));
  return { state, projectId };
}

function addMerchAudience(state, date, knownViewers = 4000) {
  const segment = state.audienceSegments.find((item) => item.spendTier === "high");
  segment.knownViewers = knownViewers;
  segment.loyalty = 100;
  segment.dailyReachEstimates.push({ date, unique: knownViewers });
  ensureAudienceBudgetCycle(state, date);
  return segment.id;
}

test("G-08 acrylic stand contribution reaches fixed-cost break-even at 86 units", () => {
  assert.equal(merchBreakEvenUnits(), 86);
});

test("merchandise design advances only through a project-targeted PROJECT_WORK slot", async () => {
  let state = game("scheduled-merch-work");
  state = unwrap(createMerchProject(state, { date: "2026-09-14" }));
  const projectId = state.projects[0].id;
  state = unwrap(confirmMerchProject(state, { projectId, date: "2026-09-14" }));
  const generic = updatePlan(state, 0, "PROJECT_WORK");
  assert.equal(generic.ok, false);
  const targeted = updatePlan(state, 0, "PROJECT_WORK", { targetId: projectId, targetType: "MERCH_PROJECT" });
  assert.equal(targeted.ok, true);
  const settled = await settleWeek(targeted.state);
  assert.equal(settled.ok, true);
  assert.equal(settled.state.projects[0].designWorkCompleted, 1);
  assert.equal(settled.state.projects[0].status, "DESIGNING");
});

test("A-20 a multi-day sale consumes one persistent candidate pool instead of rebuilding demand", () => {
  let { state, projectId, lineageId } = prepareSale("persistent-demand", 1000);
  const originalPoolId = state.projects[0].demandPool.id;
  const originalGenerated = state.projects[0].demandPool.segments.find((item) => item.lineageId === lineageId).generatedCandidates;
  state = unwrap(recordMerchPresale(state, { projectId, lineageId, requestedOrders: 10, date: "2026-09-28" }));
  state = unwrap(recordMerchPresale(state, { projectId, lineageId, requestedOrders: 10, date: "2026-10-05" }));
  const pool = state.projects[0].demandPool;
  const segmentPool = pool.segments.find((item) => item.lineageId === lineageId);
  assert.equal(pool.id, originalPoolId);
  assert.equal(pool.generatedAt, "2026-09-28");
  assert.equal(segmentPool.generatedCandidates, originalGenerated);
  assert.equal(segmentPool.purchasedCandidates, 20);
  assert.equal(segmentPool.remainingCandidates, originalGenerated - 20);
});

test("G-03 and A-21/A-25 self-run 300-unit presale preserves restricted cash until delivery and settles to 300,000 profit", () => {
  let { state, projectId, lineageId } = prepareSale("golden-merch", 4000);
  const freeBeforePresale = state.cash.free;
  state = unwrap(recordMerchPresale(state, { projectId, lineageId, requestedOrders: 300, date: "2026-09-28" }));
  assert.equal(state.projects[0].grossOrdersJpy, "750000");
  assert.equal(state.cash.free, freeBeforePresale);
  assert.equal(state.cash.restricted, "750000");
  assert.equal(state.liabilities.deferredCustomerFunds, "750000");
  assert.equal(state.finance.merchFulfilledRevenue, "0");

  state = unwrap(closeMerchSales(state, { projectId, date: "2026-10-11" }));
  state = unwrap(beginMerchProduction(state, { projectId, date: "2026-10-11" }));
  assert.equal(state.projects[0].costs.productionJpy, "270000");
  assert.equal(state.projects[0].costs.storeFeeJpy, "60000");
  assert.equal(state.cash.restricted, "420000");
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-11-08" }));
  state = unwrap(startMerchFulfillment(state, { projectId, date: "2026-11-08" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-11-15" }));
  assert.equal(state.finance.merchFulfilledRevenue, "750000");
  assert.equal(state.liabilities.deferredCustomerFunds, "0");
  state = unwrap(settleMerchProject(state, { projectId, date: "2026-11-29" }));

  assert.equal(state.projects[0].status, "SETTLED");
  assert.equal(state.projects[0].projectProfitJpy, "300000");
  assert.equal(state.finance.projectProfit, "300000");
  assert.equal(state.cash.free, "900000");
  assert.equal(state.cash.restricted, "0");
  for (const entry of state.history.journalEntries) {
    const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n);
    const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n);
    assert.equal(debit, credit, entry.id);
  }
});

test("G-04 company-led 300-unit project records only a 90,000 royalty receivable in the personal ledger", () => {
  let { state, projectId, lineageId } = prepareCompanySale("golden-company-merch", 4000);
  const project = state.projects[0];
  assert.equal(project.fundingParty, "agency_homolive");
  assert.equal(project.storeController, "agency_homolive");
  assert.equal(project.fulfillmentParty, "agency_homolive");
  assert.equal(project.royaltySurvivesExit, true);
  assert.equal(project.contractSnapshot.royaltyBps, 3000);

  state = unwrap(recordMerchPresale(state, { projectId, lineageId, requestedOrders: 300, date: "2026-09-28" }));
  assert.equal(state.projects[0].grossOrdersJpy, "750000");
  assert.equal(state.projects[0].companyLedger.restrictedCashJpy, "750000");
  assert.equal(state.cash.free, "600000");
  assert.equal(state.cash.restricted, "0");
  assert.equal(state.liabilities.deferredCustomerFunds, "0");
  assert.equal(state.finance.merchOrderGmv, "0");

  state = unwrap(closeMerchSales(state, { projectId, date: "2026-10-11" }));
  state = unwrap(beginMerchProduction(state, { projectId, date: "2026-10-11" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-11-08" }));
  state = unwrap(startMerchFulfillment(state, { projectId, date: "2026-11-08" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-11-15" }));
  state = unwrap(settleMerchProject(state, { projectId, date: "2026-11-29" }));

  const settled = state.projects[0];
  assert.equal(settled.projectProfitJpy, "300000");
  assert.equal(settled.royaltyJpy, "90000");
  assert.equal(state.cash.free, "600000");
  assert.equal(state.cash.receivable, "90000");
  assert.equal(state.finance.merchOrderGmv, "0");
  assert.equal(state.finance.merchFulfilledRevenue, "0");
  assert.equal(state.finance.projectProfit, "0");
  assert.equal(state.finance.royaltyCreatorEarned, "90000");
  assert.equal(state.history.royaltyTransactions[0].projectGrossJpy, "750000");
  assert.equal(state.history.receivables.at(-1).type, "ROYALTY");
  assert.equal(state.history.receivables.at(-1).dueDate, "2027-01-10");
  for (const entry of settled.companyLedger.journalEntries) {
    const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n);
    const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n);
    assert.equal(debit, credit, entry.id);
  }
  assert.equal(processDueReceivables(state, "2027-01-10"), 90000n);
  assert.equal(state.cash.free, "690000");
  assert.equal(state.cash.receivable, "0");
  assert.equal(state.finance.royaltyCreatorReceived, "90000");
});

test("a loss-making company merchandise project creates no player debt or negative royalty", () => {
  let { state, projectId, lineageId } = prepareCompanySale("company-merch-loss", 625);
  state = unwrap(recordMerchPresale(state, { projectId, lineageId, requestedOrders: 50, date: "2026-09-28" }));
  state = unwrap(closeMerchSales(state, { projectId, date: "2026-10-11" }));
  state = unwrap(beginMerchProduction(state, { projectId, date: "2026-10-11" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-11-08" }));
  state = unwrap(startMerchFulfillment(state, { projectId, date: "2026-11-08" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-11-15" }));
  state = unwrap(settleMerchProject(state, { projectId, date: "2026-11-29" }));
  assert.equal(state.projects[0].projectProfitJpy, "-50000");
  assert.equal(state.projects[0].royaltyJpy, "0");
  assert.equal(state.cash.free, "600000");
  assert.equal(state.cash.receivable, "0");
  assert.equal(state.cash.payable, "0");
  assert.equal(state.history.royaltyTransactions.length, 0);
  assert.equal(state.history.receivables.length, 0);
});

test("post-delivery refunds use cumulative deltas and restore only actually resellable inventory", () => {
  let { state, projectId } = deliverPreparedSale(prepareSale("delivered-refund", 4000));
  const tooEarly = refundDeliveredMerch(state, { projectId, transactionId: "merch_return_early", cumulativeRefundOrders: 1, cumulativeRestockableOrders: 0, date: "2026-11-14" });
  assert.equal(tooEarly.code, "INVALID_EVENT_DATE");
  state = unwrap(refundDeliveredMerch(state, { projectId, transactionId: "merch_return_1", cumulativeRefundOrders: 10, cumulativeRestockableOrders: 6, date: "2026-11-20" }));
  state = unwrap(refundDeliveredMerch(state, { projectId, transactionId: "merch_return_2", cumulativeRefundOrders: 15, cumulativeRestockableOrders: 8, date: "2026-11-21" }));
  const project = state.projects[0];
  assert.equal(project.postDeliveryRefundJpy, "37500");
  assert.equal(project.refundedOrders, 15);
  assert.equal(project.restockedOrders, 8);
  assert.equal(project.inventoryQuantity, 8);
  assert.equal(project.inventoryValueJpy, "7200");
  assert.equal(project.costs.cogsJpy, "262800");
  assert.equal(project.restrictedBalanceJpy, "382500");
  assert.equal(state.finance.merchFulfilledRevenue, "712500");
  assert.equal(state.history.merchPostDeliveryRefunds.length, 2);
  const duplicate = refundDeliveredMerch(state, { projectId, transactionId: "merch_return_2", cumulativeRefundOrders: 15, cumulativeRestockableOrders: 8, date: "2026-11-21" });
  assert.equal(duplicate.code, "DUPLICATE_TRANSACTION");
  state = unwrap(settleMerchProject(state, { projectId, date: "2026-11-29" }));
  assert.equal(state.projects[0].projectProfitJpy, "269700");
  assert.equal(state.cash.free, "862500");
  for (const entry of state.history.journalEntries) {
    const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n);
    const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n);
    assert.equal(debit, credit, entry.id);
  }
});

test("company post-delivery refund stays in the company subledger and reduces only positive-profit royalty", () => {
  let { state, projectId } = deliverPreparedSale(prepareCompanySale("company-delivered-refund", 4000));
  state = unwrap(refundDeliveredMerch(state, { projectId, transactionId: "company_merch_return_1", cumulativeRefundOrders: 10, cumulativeRestockableOrders: 10, date: "2026-11-20" }));
  assert.equal(state.cash.free, "600000");
  assert.equal(state.cash.restricted, "0");
  assert.equal(state.finance.merchFulfilledRevenue, "0");
  assert.equal(state.projects[0].companyLedger.restrictedCashJpy, "725000");
  state = unwrap(settleMerchProject(state, { projectId, date: "2026-11-29" }));
  assert.equal(state.projects[0].projectProfitJpy, "284000");
  assert.equal(state.projects[0].royaltyJpy, "85200");
  assert.equal(state.cash.free, "600000");
  assert.equal(state.cash.receivable, "85200");
  assert.equal(state.cash.payable, "0");
});

test("an unfunded self-run merchandise refund becomes a payable that can be cleared only from free cash", () => {
  let { state, projectId } = deliverPreparedSale(prepareSale("merch-refund-payable", 4000));
  state.cash.restricted = "0";
  state.projects[0].restrictedBalanceJpy = "0";
  state.cash.free = "0";
  state = unwrap(refundDeliveredMerch(state, { projectId, transactionId: "merch_return_payable", cumulativeRefundOrders: 1, cumulativeRestockableOrders: 0, date: "2026-11-20" }));
  assert.equal(state.projects[0].refundPayableJpy, "2500");
  assert.equal(state.cash.payable, "2500");
  const blocked = payMerchRefundPayable(state, { projectId, amountJpy: "2500", date: "2026-11-21" });
  assert.equal(blocked.code, "INSUFFICIENT_FREE_CASH");
  state.cash.free = "2500";
  state = unwrap(payMerchRefundPayable(state, { projectId, amountJpy: "2500", date: "2026-11-21" }));
  assert.equal(state.projects[0].refundPayableJpy, "0");
  assert.equal(state.cash.payable, "0");
  assert.equal(state.liabilities.refundPayable, "0");
  assert.equal(state.cash.free, "0");
});

test("digital goods skip sampling, production, shipping, and inventory while retaining fixed creation cost", () => {
  let state = game("digital-goods");
  state = unwrap(createMerchProject(state, { date: "2026-09-14", templateId: "DIGITAL_VOICE_PACK_STANDARD" }));
  const projectId = state.projects[0].id;
  state = unwrap(confirmMerchProject(state, { projectId, date: "2026-09-14" }));
  assert.equal(state.cash.free, "560000");
  state = unwrap(recordMerchDesignWork(state, { projectId, date: "2026-09-14" }));
  state = unwrap(recordMerchDesignWork(state, { projectId, date: "2026-09-14" }));
  assert.equal(state.projects[0].status, "READY_TO_SELL");
  assert.equal(state.projects[0].samplingDueDate, undefined);
  const lineageId = addMerchAudience(state, "2026-09-14", 2000);
  state = unwrap(openMerchSales(state, { projectId, date: "2026-09-14" }));
  state = unwrap(recordMerchPresale(state, { projectId, lineageId, requestedOrders: 100, date: "2026-09-14" }));
  assert.equal(state.projects[0].grossOrdersJpy, "120000");
  state = unwrap(closeMerchSales(state, { projectId, date: "2026-09-27" }));
  assert.equal(state.projects[0].status, "FULFILLING");
  assert.equal(state.projects[0].costs.storeFeeJpy, "9600");
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-09-27" }));
  assert.equal(state.projects[0].status, "AFTER_SALES");
  assert.equal(state.projects[0].inventoryQuantity, 0);
  assert.equal(state.projects[0].inventoryValueJpy, "0");
  assert.equal(state.projects[0].costs.cogsJpy, "0");
  const invalidRestock = refundDeliveredMerch(state, { projectId, transactionId: "digital_refund_invalid_stock", cumulativeRefundOrders: 1, cumulativeRestockableOrders: 1, date: "2026-09-28" });
  assert.equal(invalidRestock.code, "INVALID_FINANCIAL_BASIS");
  state = unwrap(settleMerchProject(state, { projectId, date: "2026-10-11" }));
  assert.equal(state.projects[0].projectProfitJpy, "70400");
  assert.equal(state.cash.free, "670400");
});

test("ready stock occupies funds before sale, caps orders by inventory, and preserves unsold units", () => {
  let state = game("ready-stock");
  state = unwrap(createMerchProject(state, { date: "2026-09-14", templateId: "READY_STOCK_BADGE_STANDARD" }));
  const projectId = state.projects[0].id;
  state = unwrap(confirmMerchProject(state, { projectId, date: "2026-09-14" }));
  state = unwrap(recordMerchDesignWork(state, { projectId, date: "2026-09-14" }));
  state = unwrap(recordMerchDesignWork(state, { projectId, date: "2026-09-14" }));
  assert.equal(state.projects[0].status, "SAMPLING");
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-09-21" }));
  assert.equal(state.projects[0].status, "PRODUCING");
  assert.equal(state.projects[0].productionQuantity, 50);
  assert.equal(state.projects[0].costs.productionJpy, "15000");
  assert.equal(state.cash.free, "525000");
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-10-05" }));
  assert.equal(state.projects[0].status, "READY_TO_SELL");
  assert.equal(state.projects[0].inventoryQuantity, 50);
  assert.equal(state.projects[0].inventoryValueJpy, "15000");
  const lineageId = addMerchAudience(state, "2026-10-05", 1000);
  state = unwrap(openMerchSales(state, { projectId, date: "2026-10-05" }));
  state = unwrap(recordMerchPresale(state, { projectId, lineageId, requestedOrders: 30, date: "2026-10-05" }));
  assert.equal(state.projects[0].inventoryQuantity, 20);
  assert.equal(state.projects[0].reservedInventoryQuantity, 30);
  const capped = recordMerchPresale(state, { projectId, lineageId, requestedOrders: 100, date: "2026-10-05" });
  assert.equal(capped.ok, true);
  assert.equal(capped.orders, 20);
  const cancelled = cancelMerchProject(state, { projectId, date: "2026-10-06" });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.project.inventoryQuantity, 50);
  assert.equal(cancelled.project.cancellationTreatment.materialResidualJpy, "15000");

  state = unwrap(closeMerchSales(state, { projectId, date: "2026-10-18" }));
  assert.equal(state.projects[0].status, "READY_TO_SHIP");
  assert.equal(state.projects[0].costs.storeFeeJpy, "2160");
  state = unwrap(startMerchFulfillment(state, { projectId, date: "2026-10-18" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-10-25" }));
  assert.equal(state.projects[0].inventoryQuantity, 20);
  assert.equal(state.projects[0].inventoryValueJpy, "6000");
  assert.equal(state.projects[0].costs.cogsJpy, "9000");
  state = unwrap(settleMerchProject(state, { projectId, date: "2026-11-08" }));
  assert.equal(state.projects[0].projectProfitJpy, "-44160");
  assert.equal(state.cash.free, "549840");
});

test("company-led digital goods keep gross sales outside personal cash and create royalty only at settlement", () => {
  let state = companyGame("company-digital-goods");
  state = unwrap(createMerchProject(state, { date: "2026-09-14", fundingModel: "COMPANY_LED", templateId: "DIGITAL_VOICE_PACK_STANDARD" }));
  const projectId = state.projects[0].id;
  state = unwrap(confirmMerchProject(state, { projectId, date: "2026-09-14" }));
  state = unwrap(recordMerchDesignWork(state, { projectId, date: "2026-09-14" }));
  state = unwrap(recordMerchDesignWork(state, { projectId, date: "2026-09-14" }));
  const lineageId = addMerchAudience(state, "2026-09-14", 2000);
  state = unwrap(openMerchSales(state, { projectId, date: "2026-09-14" }));
  state = unwrap(recordMerchPresale(state, { projectId, lineageId, requestedOrders: 100, date: "2026-09-14" }));
  state = unwrap(closeMerchSales(state, { projectId, date: "2026-09-27" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-09-27" }));
  state = unwrap(settleMerchProject(state, { projectId, date: "2026-10-11" }));
  assert.equal(state.projects[0].projectProfitJpy, "70400");
  assert.equal(state.projects[0].royaltyJpy, "21120");
  assert.equal(state.cash.free, "600000");
  assert.equal(state.cash.restricted, "0");
  assert.equal(state.cash.receivable, "21120");
  assert.equal(state.finance.merchOrderGmv, "0");
  assert.equal(state.finance.merchFulfilledRevenue, "0");
});

test("A-22 restricted presale cash cannot fund an unrelated project start", () => {
  let state = game("restricted-is-not-free");
  state = unwrap(createMerchProject(state, { date: "2026-09-14" }));
  state.cash.free = "0";
  state.cash.restricted = "500000";
  const result = confirmMerchProject(state, { projectId: state.projects[0].id, date: "2026-09-14" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INSUFFICIENT_FREE_CASH");
  assert.equal(state.cash.restricted, "500000");
});

test("A-24 an under-MOQ project exposes all three paths and top-up creates retained inventory", () => {
  let { state, projectId, lineageId } = prepareSale("under-moq", 250);
  state = unwrap(recordMerchPresale(state, { projectId, lineageId, requestedOrders: 20, date: "2026-09-28" }));
  const closed = closeMerchSales(state, { projectId, date: "2026-10-11" });
  assert.equal(closed.ok, true);
  assert.deepEqual(closed.project.decision.options, ["TOP_UP", "NEGOTIATE", "REFUND"]);
  const blocked = beginMerchProduction(closed.state, { projectId, date: "2026-10-11" });
  assert.equal(blocked.code, "UNDER_MOQ_DECISION_REQUIRED");
  state = unwrap(resolveUnderMoq(closed.state, { projectId, option: "TOP_UP", date: "2026-10-11" }));
  assert.equal(state.projects[0].productionQuantity, 50);
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-11-08" }));
  state = unwrap(startMerchFulfillment(state, { projectId, date: "2026-11-08" }));
  state = unwrap(processMerchProjectDate(state, { projectId, date: "2026-11-15" }));
  assert.equal(state.projects[0].inventoryQuantity, 30);
});

test("A-23 cancelling after production payment creates refund treatment without erasing spent cost", () => {
  let { state, projectId, lineageId } = prepareSale("cancel-after-production", 250);
  state = unwrap(recordMerchPresale(state, { projectId, lineageId, requestedOrders: 20, date: "2026-09-28" }));
  state = unwrap(closeMerchSales(state, { projectId, date: "2026-10-11" }));
  state = unwrap(resolveUnderMoq(state, { projectId, option: "TOP_UP", date: "2026-10-11" }));
  assert.equal(state.projects[0].productionPrepaymentJpy, "45000");
  state = unwrap(cancelMerchProject(state, { projectId, date: "2026-10-12", reason: "PLAYER_CANCELLED" }));
  const project = state.projects[0];
  assert.equal(project.status, "CANCELLED");
  assert.equal(project.cancellationTreatment.refundJpy, "50000");
  assert.equal(project.cancellationTreatment.writtenOffProductionJpy, "45000");
  assert.equal(project.costs.productionJpy, "45000");
  assert.equal(project.costs.cancellationJpy, "45000");
  assert.equal(project.deferredCustomerFundsJpy, "0");
  assert.equal(state.history.merchRefunds.length, 1);
});
