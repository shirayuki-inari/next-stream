import { BALANCE } from "../../rules/balance_standard_0_1.js";

const TEMPLATE = BALANCE.merch.acrylicStand;
const TEMPLATES = new Map(Object.values(BALANCE.merch).filter((template) => template?.id).map((template) => [template.id, template]));
const ACTIVE_STATES = new Set(["DRAFT", "APPROVED", "DESIGNING", "SAMPLING", "READY_TO_SELL", "ON_SALE", "SALES_CLOSED", "PRODUCING", "READY_TO_SHIP", "FULFILLING", "AFTER_SALES", "PAUSED"]);

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function compareIso(a, b) {
  return String(a).localeCompare(String(b));
}

function addMoney(target, key, amount) {
  target[key] = String(BigInt(target[key] || 0) + BigInt(amount));
}

function pushJournal(state, entry) {
  const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit || 0), 0n);
  const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit || 0), 0n);
  if (debit !== credit) throw new Error("UNBALANCED_JOURNAL");
  state.history.journalEntries.push(entry);
}

function pushCompanyJournal(project, entry) {
  const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit || 0), 0n);
  const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit || 0), 0n);
  if (debit !== credit) throw new Error("UNBALANCED_COMPANY_PROJECT_JOURNAL");
  project.companyLedger.journalEntries.push(entry);
}

function isCompanyLed(project) {
  return project.fundingModel === "COMPANY_LED";
}

function companyFundingEntry(project, { id, date, account, amount }) {
  pushCompanyJournal(project, { id, date, sourceId: project.id, lines: [{ account, debit: String(amount), credit: "0" }, { account: "COMPANY_PROJECT_FUNDING", debit: "0", credit: String(amount) }] });
}

function projectResult(sourceState, projectId, allowedStates) {
  if (sourceState.phase !== "PLANNING") return { error: { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段修改商品项目" } };
  const project = sourceState.projects?.find((item) => item.id === projectId);
  if (!project || !allowedStates.includes(project.status)) return { error: { ok: false, code: "REQUIREMENT_UNMET", message: "商品项目不存在或当前阶段不可执行此操作" } };
  const state = structuredClone(sourceState);
  return { state, project: state.projects.find((item) => item.id === projectId) };
}

function activeEstimate(segment) {
  const recent = (segment.dailyReachEstimates || []).slice(-28);
  if (!recent.length || !segment.knownViewers) return 0;
  const coverage = 1 - recent.reduce((product, item) => product * (1 - Math.min(Number(item.unique || 0) / segment.knownViewers, 1)), 1);
  return Math.min(segment.knownViewers, Math.round(segment.knownViewers * coverage));
}

function hasMerchLicense(state) {
  const characterAssets = new Set(state.character.assetIds || []);
  return state.assets.some((asset) => characterAssets.has(asset.id) && asset.ownerParty === "PLAYER")
    || state.licenses.some((license) => characterAssets.has(license.assetId) && license.licenseeParty === "PLAYER" && license.allowedUses?.includes("MERCH") && !license.effectiveTo);
}

function spendProjectFunds(state, project, amount, expenseAccount, sourceSuffix) {
  const requested = BigInt(amount);
  if (isCompanyLed(project)) {
    companyFundingEntry(project, { id: `company_journal_${project.id}_${sourceSuffix}`, date: project.lastActionAt, account: expenseAccount, amount: requested });
    return { ok: true, fromRestricted: 0n, fromFree: 0n, companyFunded: requested };
  }
  const restricted = BigInt(project.restrictedBalanceJpy || 0);
  const fromRestricted = restricted < requested ? restricted : requested;
  const fromFree = requested - fromRestricted;
  if (fromFree > BigInt(state.cash.free)) return { ok: false, code: "INSUFFICIENT_FREE_CASH", message: "项目专属受限资金与自由现金不足，不能动用其他项目资金" };
  project.restrictedBalanceJpy = String(restricted - fromRestricted);
  state.cash.restricted = String(BigInt(state.cash.restricted) - fromRestricted);
  state.cash.free = String(BigInt(state.cash.free) - fromFree);
  pushJournal(state, {
    id: `journal_${project.id}_${sourceSuffix}`,
    date: project.lastActionAt,
    sourceId: project.id,
    lines: [
      { account: expenseAccount, debit: String(requested), credit: "0" },
      { account: "CASH_RESTRICTED", debit: "0", credit: String(fromRestricted) },
      { account: "CASH_FREE", debit: "0", credit: String(fromFree) },
    ],
  });
  return { ok: true, fromRestricted, fromFree };
}

function recordPresaleFunds(state, project, gross, journalSuffix, date) {
  if (isCompanyLed(project)) {
    addMoney(project.companyLedger, "restrictedCashJpy", gross);
    addMoney(project.companyLedger, "deferredCustomerFundsJpy", gross);
    pushCompanyJournal(project, {
      id: `company_journal_${project.id}_${journalSuffix}`,
      date,
      sourceId: project.id,
      lines: [
        { account: "COMPANY_CASH_RESTRICTED", debit: String(gross), credit: "0" },
        { account: "COMPANY_DEFERRED_CUSTOMER_FUNDS", debit: "0", credit: String(gross) },
      ],
    });
    return;
  }
  addMoney(project, "restrictedBalanceJpy", gross);
  addMoney(project, "deferredCustomerFundsJpy", gross);
  addMoney(state.cash, "restricted", gross);
  addMoney(state.liabilities, "deferredCustomerFunds", gross);
  addMoney(state.finance, "merchOrderGmv", gross);
  pushJournal(state, {
    id: `journal_${project.id}_${journalSuffix}`,
    date,
    sourceId: project.id,
    lines: [
      { account: "CASH_RESTRICTED", debit: String(gross), credit: "0" },
      { account: "DEFERRED_CUSTOMER_FUNDS", debit: "0", credit: String(gross) },
    ],
  });
}

export function merchBreakEvenUnits(template = TEMPLATE) {
  const contribution = template.unitPriceJpy - template.unitProductionCostJpy - Math.floor(template.unitPriceJpy * template.storeFeeBps / 10000);
  return Math.ceil(template.fixedDesignSampleCostJpy / contribution);
}

export function createMerchProject(sourceState, { date, title = null, fundingModel = "SELF_RUN", templateId = TEMPLATE.id } = {}) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段创建商品项目" };
  const template = TEMPLATES.get(templateId);
  if (!template) return { ok: false, code: "INVALID_COMMAND", message: "商品模板无效" };
  if (!["SELF_RUN", "COMPANY_LED"].includes(fundingModel)) return { ok: false, code: "INVALID_COMMAND", message: "商品项目资金模式无效" };
  if (fundingModel === "SELF_RUN" && !hasMerchLicense(sourceState)) return { ok: false, code: "LICENSE_REQUIRED", message: "当前角色资产没有自营商品销售许可" };
  if (fundingModel === "COMPANY_LED" && !sourceState.affiliation?.agencyId) return { ok: false, code: "REQUIREMENT_UNMET", message: "当前没有可承担公司项目的主所属" };
  if (sourceState.projects?.some((project) => project.type === "MERCH" && ACTIVE_STATES.has(project.status))) return { ok: false, code: "PROJECT_CONFLICT", message: "已有未结束的商品项目" };
  const state = structuredClone(sourceState);
  const id = `merch_${state.id}_${state.projects.length + 1}`;
  const companyLed = fundingModel === "COMPANY_LED";
  const responsibleParty = companyLed ? state.affiliation.agencyId : "PLAYER";
  const project = {
    id,
    type: "MERCH",
    templateId: template.id,
    productKind: template.productKind,
    salesMode: template.salesMode,
    title: String(title || template.name).trim().slice(0, 32) || template.name,
    status: "DRAFT",
    fundingModel,
    ownerParty: responsibleParty,
    fundingParty: responsibleParty,
    storeController: responsibleParty,
    fulfillmentParty: responsibleParty,
    characterId: state.character.id,
    assetIds: [...state.character.assetIds],
    contractSnapshotId: state.contract?.id || null,
    contractSnapshot: companyLed && state.contract ? {
      id: state.contract.id,
      version: state.contract.version,
      royaltyBps: BALANCE.contracts.corporateMerchProfitRoyaltyBps,
      fundingParty: responsibleParty,
      storeController: responsibleParty,
      fulfillmentParty: responsibleParty,
      royaltySurvivesExit: true,
    } : null,
    royaltyBps: companyLed ? BALANCE.contracts.corporateMerchProfitRoyaltyBps : 0,
    royaltySurvivesExit: companyLed,
    createdAt: date,
    lastActionAt: date,
    unitPriceJpy: String(template.unitPriceJpy),
    unitProductionCostJpy: String(template.unitProductionCostJpy),
    storeFeeBps: template.storeFeeBps,
    fixedDesignSampleCostJpy: String(template.fixedDesignSampleCostJpy),
    minimumOrderQuantity: template.minimumOrderQuantity,
    initialStockQuantity: template.initialStockQuantity || 0,
    designWorkRequired: template.designWorkUnits,
    timing: { samplingDays: template.samplingDays, salesDays: template.salesDays, productionDays: template.productionDays, fulfillmentDays: template.fulfillmentDays, afterSalesDays: template.afterSalesDays },
    designWorkCompleted: 0,
    orderCount: 0,
    deliveredOrders: 0,
    productionQuantity: 0,
    inventoryQuantity: 0,
    reservedInventoryQuantity: 0,
    grossOrdersJpy: "0",
    fulfilledRevenueJpy: "0",
    restrictedBalanceJpy: "0",
    deferredCustomerFundsJpy: "0",
    refundPayableJpy: "0",
    productionPrepaymentJpy: "0",
    inventoryValueJpy: "0",
    costs: { fixedJpy: "0", productionJpy: "0", storeFeeJpy: "0", cogsJpy: "0", cancellationJpy: "0" },
    demandPool: null,
    decision: null,
    cancellationTreatment: null,
    postDeliveryRefundJpy: "0",
    refundedOrders: 0,
    restockedOrders: 0,
    projectProfitJpy: null,
    royaltyJpy: "0",
    companyLedger: companyLed ? { restrictedCashJpy: "0", deferredCustomerFundsJpy: "0", productionPrepaymentJpy: "0", inventoryValueJpy: "0", journalEntries: [] } : null,
  };
  state.projects.push(project);
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function confirmMerchProject(sourceState, { projectId, date }) {
  const context = projectResult(sourceState, projectId, ["DRAFT"]);
  if (context.error) return context.error;
  const { state, project } = context;
  const fixed = BigInt(project.fixedDesignSampleCostJpy);
  if (!isCompanyLed(project) && fixed > BigInt(state.cash.free)) return { ok: false, code: "INSUFFICIENT_FREE_CASH", message: "自由现金不足，不能使用履约受限资金启动无关项目" };
  project.costs.fixedJpy = String(fixed);
  project.status = "DESIGNING";
  project.confirmedAt = date;
  project.lastActionAt = date;
  if (isCompanyLed(project)) companyFundingEntry(project, { id: `company_journal_${project.id}_fixed`, date, account: "FIXED_PROJECT_COST", amount: fixed });
  else {
    state.cash.free = String(BigInt(state.cash.free) - fixed);
    pushJournal(state, { id: `journal_${project.id}_fixed`, date, sourceId: project.id, lines: [{ account: "FIXED_PROJECT_COST", debit: String(fixed), credit: "0" }, { account: "CASH_FREE", debit: "0", credit: String(fixed) }] });
  }
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function recordMerchDesignWork(sourceState, { projectId, date }) {
  const context = projectResult(sourceState, projectId, ["DESIGNING"]);
  if (context.error) return context.error;
  const { state, project } = context;
  applyMerchDesignWork(state, projectId, date);
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function applyMerchDesignWork(state, projectId, date) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project || project.status !== "DESIGNING") throw new Error("REQUIREMENT_UNMET");
  project.designWorkCompleted += 1;
  project.lastActionAt = date;
  if (project.designWorkCompleted >= project.designWorkRequired) {
    if (project.salesMode === "DIGITAL") {
      project.status = "READY_TO_SELL";
      project.digitalMasterCompletedAt = date;
    } else {
      project.status = "SAMPLING";
      project.samplingStartedAt = date;
      project.samplingDueDate = addDays(date, project.timing.samplingDays);
    }
  }
  return project;
}

export function processMerchProjectDate(sourceState, { projectId, date }) {
  const context = projectResult(sourceState, projectId, ["SAMPLING", "PRODUCING", "FULFILLING"]);
  if (context.error) return context.error;
  const { state, project } = context;
  project.lastActionAt = date;
  if (project.status === "SAMPLING") {
    if (compareIso(date, project.samplingDueDate) < 0) return { ok: false, code: "WAITING_PERIOD", message: `${project.salesMode === "READY_STOCK" ? "备货准备" : "打样"}将在 ${project.samplingDueDate} 完成` };
    project.sampleCompletedAt = date;
    if (project.salesMode === "READY_STOCK") {
      const productionQuantity = project.initialStockQuantity;
      const production = BigInt(project.unitProductionCostJpy) * BigInt(productionQuantity);
      const spent = spendProjectFunds(state, project, production, "PRODUCTION_PREPAYMENT", "stock_production");
      if (!spent.ok) return spent;
      project.productionQuantity = productionQuantity;
      project.productionPrepaymentJpy = String(production);
      if (isCompanyLed(project)) project.companyLedger.productionPrepaymentJpy = String(production);
      project.costs.productionJpy = String(production);
      project.status = "PRODUCING";
      project.productionStartedAt = date;
      project.productionDueDate = addDays(date, project.timing.productionDays);
      project.decision = { type: "INITIAL_STOCK", quantity: productionQuantity };
    } else {
      project.status = "READY_TO_SELL";
    }
  } else if (project.status === "PRODUCING") {
    if (compareIso(date, project.productionDueDate) < 0) return { ok: false, code: "WAITING_PERIOD", message: `生产将在 ${project.productionDueDate} 完成` };
    project.status = project.salesMode === "READY_STOCK" ? "READY_TO_SELL" : "READY_TO_SHIP";
    if (project.status === "READY_TO_SHIP") project.readyToShipAt = date;
    else project.stockReadyAt = date;
    project.inventoryQuantity = project.productionQuantity;
    project.inventoryValueJpy = project.productionPrepaymentJpy;
    if (isCompanyLed(project)) {
      project.companyLedger.inventoryValueJpy = project.inventoryValueJpy;
      project.companyLedger.productionPrepaymentJpy = "0";
      pushCompanyJournal(project, { id: `company_journal_${project.id}_inventory`, date, sourceId: project.id, lines: [{ account: "COMPANY_INVENTORY", debit: project.inventoryValueJpy, credit: "0" }, { account: "PRODUCTION_PREPAYMENT", debit: "0", credit: project.inventoryValueJpy }] });
    } else pushJournal(state, { id: `journal_${project.id}_inventory`, date, sourceId: project.id, lines: [{ account: "INVENTORY", debit: project.inventoryValueJpy, credit: "0" }, { account: "PRODUCTION_PREPAYMENT", debit: "0", credit: project.inventoryValueJpy }] });
    project.productionPrepaymentJpy = "0";
  } else {
    if (compareIso(date, project.fulfillmentDueDate) < 0) return { ok: false, code: "WAITING_PERIOD", message: `发货处理将在 ${project.fulfillmentDueDate} 完成` };
    const delivered = project.orderCount;
    const revenue = BigInt(project.grossOrdersJpy);
    const cogs = BigInt(project.unitProductionCostJpy) * BigInt(delivered);
    project.status = "AFTER_SALES";
    project.deliveredOrders = delivered;
    if (project.salesMode === "PRESALE") project.inventoryQuantity -= delivered;
    if (project.salesMode === "READY_STOCK") project.reservedInventoryQuantity = 0;
    project.inventoryValueJpy = String(BigInt(project.inventoryValueJpy) - cogs);
    project.fulfilledRevenueJpy = String(revenue);
    project.deferredCustomerFundsJpy = "0";
    project.costs.cogsJpy = String(cogs);
    project.fulfilledAt = date;
    project.afterSalesEndDate = addDays(date, project.timing.afterSalesDays);
    if (isCompanyLed(project)) {
      project.companyLedger.deferredCustomerFundsJpy = "0";
      project.companyLedger.inventoryValueJpy = project.inventoryValueJpy;
      pushCompanyJournal(project, { id: `company_journal_${project.id}_fulfillment`, date, sourceId: project.id, lines: [{ account: "COMPANY_DEFERRED_CUSTOMER_FUNDS", debit: String(revenue), credit: "0" }, { account: "COMPANY_MERCH_REVENUE", debit: "0", credit: String(revenue) }] });
      if (cogs > 0n) pushCompanyJournal(project, { id: `company_journal_${project.id}_cogs`, date, sourceId: project.id, lines: [{ account: "COMPANY_COGS", debit: String(cogs), credit: "0" }, { account: "COMPANY_INVENTORY", debit: "0", credit: String(cogs) }] });
    } else {
      state.liabilities.deferredCustomerFunds = String(BigInt(state.liabilities.deferredCustomerFunds) - revenue);
      addMoney(state.finance, "merchFulfilledRevenue", revenue);
      pushJournal(state, { id: `journal_${project.id}_fulfillment`, date, sourceId: project.id, lines: [{ account: "DEFERRED_CUSTOMER_FUNDS", debit: String(revenue), credit: "0" }, { account: "MERCH_REVENUE", debit: "0", credit: String(revenue) }] });
      if (cogs > 0n) pushJournal(state, { id: `journal_${project.id}_cogs`, date, sourceId: project.id, lines: [{ account: "COGS", debit: String(cogs), credit: "0" }, { account: "INVENTORY", debit: "0", credit: String(cogs) }] });
    }
  }
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function openMerchSales(sourceState, { projectId, date }) {
  const context = projectResult(sourceState, projectId, ["READY_TO_SELL"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (!project.demandPool) {
    const segments = state.audienceSegments.map((segment) => {
      const propensity = segment.spendTier === "high" ? 0.08 : segment.spendTier === "light" ? 0.02 : 0;
      const candidates = Math.floor(activeEstimate(segment) * propensity);
      return { lineageId: segment.id, generatedCandidates: candidates, remainingCandidates: candidates, reachedCandidates: 0, purchasedCandidates: 0 };
    });
    project.demandPool = { id: `demand_${project.id}`, generatedAt: date, segments };
  }
  project.status = "ON_SALE";
  project.salesStartedAt = date;
  project.salesEndDate = addDays(date, project.timing.salesDays - 1);
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function recordMerchPresale(sourceState, { projectId, lineageId, requestedOrders, date }) {
  const context = projectResult(sourceState, projectId, ["ON_SALE"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (compareIso(date, project.salesEndDate) > 0) return { ok: false, code: "SALES_WINDOW_CLOSED", message: "销售窗口已经结束" };
  const pool = project.demandPool?.segments.find((item) => item.lineageId === lineageId);
  const budget = state.audienceBudgets.find((item) => item.lineageId === lineageId && item.performerId === state.performer.id);
  if (!pool || !budget?.initialized) return { ok: false, code: "REQUIREMENT_UNMET", message: "该观众谱系没有可用候选池或本期预算" };
  const wanted = Math.max(0, Math.floor(Number(requestedOrders || 0)));
  const byBudget = Number(BigInt(budget.remainingJpy) / BigInt(project.unitPriceJpy));
  const byInventory = project.salesMode === "READY_STOCK" ? project.inventoryQuantity : Number.MAX_SAFE_INTEGER;
  const orders = Math.min(wanted, pool.remainingCandidates, byBudget, byInventory);
  if (orders <= 0) return { ok: false, code: project.salesMode === "READY_STOCK" && project.inventoryQuantity <= 0 ? "OUT_OF_STOCK" : "AUDIENCE_BUDGET_EXHAUSTED", message: project.salesMode === "READY_STOCK" && project.inventoryQuantity <= 0 ? "现货库存已经售罄" : "候选池或共享消费预算不足" };
  const gross = BigInt(project.unitPriceJpy) * BigInt(orders);
  pool.remainingCandidates -= orders;
  pool.reachedCandidates += orders;
  pool.purchasedCandidates += orders;
  budget.remainingJpy = String(BigInt(budget.remainingJpy) - gross);
  project.orderCount += orders;
  if (project.salesMode === "READY_STOCK") {
    project.inventoryQuantity -= orders;
    project.reservedInventoryQuantity += orders;
  }
  addMoney(project, "grossOrdersJpy", gross);
  project.lastActionAt = date;
  recordPresaleFunds(state, project, gross, `presale_${state.snapshotVersion + 1}`, date);
  state.snapshotVersion += 1;
  return { ok: true, state, project, orders, grossJpy: String(gross) };
}

export function promoteMerchProject(sourceState, { projectId, date }) {
  const context = projectResult(sourceState, projectId, ["ON_SALE"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (compareIso(date, project.salesEndDate) > 0) return { ok: false, code: "SALES_WINDOW_CLOSED", message: "销售窗口已经结束，请先关闭销售" };
  project.promotionDates ??= [];
  if (project.promotionDates.includes(date)) return { ok: false, code: "NO_CHANGE", message: "本游戏日已经宣传过该商品" };
  let totalOrders = 0;
  let totalReached = 0;
  let totalGross = 0n;
  for (const pool of project.demandPool?.segments || []) {
    if (pool.remainingCandidates <= 0) continue;
    const reached = Math.max(1, Math.ceil(pool.remainingCandidates * 0.35));
    const budget = state.audienceBudgets.find((item) => item.lineageId === pool.lineageId && item.performerId === state.performer.id);
    const affordable = budget?.initialized ? Number(BigInt(budget.remainingJpy) / BigInt(project.unitPriceJpy)) : 0;
    const inventoryRemaining = project.salesMode === "READY_STOCK" ? project.inventoryQuantity - totalOrders : Number.MAX_SAFE_INTEGER;
    const orders = Math.min(reached, affordable, Math.max(0, inventoryRemaining));
    const gross = BigInt(project.unitPriceJpy) * BigInt(orders);
    pool.remainingCandidates -= reached;
    pool.reachedCandidates += reached;
    pool.purchasedCandidates += orders;
    if (budget && gross > 0n) budget.remainingJpy = String(BigInt(budget.remainingJpy) - gross);
    totalReached += reached;
    totalOrders += orders;
    totalGross += gross;
  }
  project.promotionDates.push(date);
  project.orderCount += totalOrders;
  if (project.salesMode === "READY_STOCK") {
    project.inventoryQuantity -= totalOrders;
    project.reservedInventoryQuantity += totalOrders;
  }
  addMoney(project, "grossOrdersJpy", totalGross);
  project.lastActionAt = date;
  if (totalGross > 0n) recordPresaleFunds(state, project, totalGross, `promotion_${state.snapshotVersion + 1}`, date);
  state.snapshotVersion += 1;
  return { ok: true, state, project, reached: totalReached, orders: totalOrders, grossJpy: String(totalGross) };
}

export function closeMerchSales(sourceState, { projectId, date }) {
  const context = projectResult(sourceState, projectId, ["ON_SALE"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (compareIso(date, project.salesEndDate) < 0) return { ok: false, code: "WAITING_PERIOD", message: `销售将在 ${project.salesEndDate} 结束` };
  project.salesClosedAt = date;
  project.lastActionAt = date;
  if (project.salesMode !== "PRESALE") {
    const storeFee = BigInt(project.grossOrdersJpy) * BigInt(project.storeFeeBps) / 10000n;
    if (storeFee > 0n) {
      const spent = spendProjectFunds(state, project, storeFee, "PLATFORM_OR_STORE_FEE", "store_fee");
      if (!spent.ok) return spent;
    }
    project.costs.storeFeeJpy = String(storeFee);
    if (project.salesMode === "DIGITAL") {
      project.status = "FULFILLING";
      project.fulfillmentStartedAt = date;
      project.fulfillmentDueDate = date;
    } else {
      project.status = "READY_TO_SHIP";
      project.readyToShipAt = date;
    }
  } else {
    project.status = "SALES_CLOSED";
    if (project.orderCount < project.minimumOrderQuantity) project.decision = { type: "UNDER_MOQ", options: ["TOP_UP", "NEGOTIATE", "REFUND"] };
  }
  state.snapshotVersion += 1;
  return { ok: true, state, project, requiresDecision: Boolean(project.decision) };
}

function startProduction(state, project, { productionQuantity, unitCostJpy, date, decision }) {
  project.lastActionAt = date;
  const production = BigInt(productionQuantity) * BigInt(unitCostJpy);
  const storeFee = BigInt(project.grossOrdersJpy) * BigInt(project.storeFeeBps) / 10000n;
  const productionSpend = spendProjectFunds(state, project, production, "PRODUCTION_PREPAYMENT", "production");
  if (!productionSpend.ok) return productionSpend;
  const storeSpend = spendProjectFunds(state, project, storeFee, "PLATFORM_OR_STORE_FEE", "store_fee");
  if (!storeSpend.ok) return storeSpend;
  project.productionQuantity = productionQuantity;
  project.unitProductionCostJpy = String(unitCostJpy);
  project.productionPrepaymentJpy = String(production);
  if (isCompanyLed(project)) project.companyLedger.productionPrepaymentJpy = String(production);
  project.costs.productionJpy = String(production);
  project.costs.storeFeeJpy = String(storeFee);
  project.status = "PRODUCING";
  project.productionStartedAt = date;
  project.productionDueDate = addDays(date, project.timing.productionDays);
  project.decision = decision;
  return { ok: true };
}

export function beginMerchProduction(sourceState, { projectId, date }) {
  const context = projectResult(sourceState, projectId, ["SALES_CLOSED"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (project.salesMode !== "PRESALE") return { ok: false, code: "REQUIREMENT_UNMET", message: "该销售模式不在销售结束后启动生产" };
  if (project.orderCount < project.minimumOrderQuantity) return { ok: false, code: "UNDER_MOQ_DECISION_REQUIRED", message: "订单低于起订量，请选择补足、协商或退款", details: { options: ["TOP_UP", "NEGOTIATE", "REFUND"] } };
  const started = startProduction(state, project, { productionQuantity: project.orderCount, unitCostJpy: Number(project.unitProductionCostJpy), date, decision: { type: "ORDER_QUANTITY" } });
  if (!started.ok) return started;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function resolveUnderMoq(sourceState, { projectId, option, date }) {
  if (option === "REFUND") return cancelMerchProject(sourceState, { projectId, date, reason: "UNDER_MOQ_REFUND" });
  const context = projectResult(sourceState, projectId, ["SALES_CLOSED"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (project.orderCount >= project.minimumOrderQuantity || project.decision?.type !== "UNDER_MOQ") return { ok: false, code: "REQUIREMENT_UNMET", message: "项目不需要起订量决策" };
  if (!['TOP_UP', 'NEGOTIATE'].includes(option)) return { ok: false, code: "INVALID_COMMAND", message: "起订量处理选项无效" };
  const productionQuantity = option === "TOP_UP" ? project.minimumOrderQuantity : project.orderCount;
  const unitCostJpy = option === "TOP_UP" ? Number(project.unitProductionCostJpy) : Math.ceil(Number(project.unitProductionCostJpy) * TEMPLATE.negotiatedUnitCostBps / 10000);
  const started = startProduction(state, project, { productionQuantity, unitCostJpy, date, decision: { type: "UNDER_MOQ", selected: option } });
  if (!started.ok) return started;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function startMerchFulfillment(sourceState, { projectId, date }) {
  const context = projectResult(sourceState, projectId, ["READY_TO_SHIP"]);
  if (context.error) return context.error;
  const { state, project } = context;
  project.status = "FULFILLING";
  project.fulfillmentStartedAt = date;
  project.fulfillmentDueDate = addDays(date, project.timing.fulfillmentDays);
  project.lastActionAt = date;
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}

export function refundDeliveredMerch(sourceState, { projectId, transactionId, cumulativeRefundOrders, cumulativeRestockableOrders = 0, date }) {
  const context = projectResult(sourceState, projectId, ["AFTER_SALES"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (compareIso(date, project.fulfilledAt) < 0) return { ok: false, code: "INVALID_EVENT_DATE", message: "交付完成前不能登记交付后退款" };
  if (compareIso(date, project.afterSalesEndDate) > 0) return { ok: false, code: "AFTER_SALES_WINDOW_CLOSED", message: "售后窗口已经结束" };
  if (!transactionId || typeof transactionId !== "string") return { ok: false, code: "INVALID_COMMAND", message: "退款必须引用稳定交易 ID" };
  if (state.history.merchPostDeliveryRefunds.some((refund) => refund.id === transactionId)) return { ok: false, code: "DUPLICATE_TRANSACTION", message: "该退款交易已经处理" };
  const refundOrders = Number(cumulativeRefundOrders);
  const restockableOrders = Number(cumulativeRestockableOrders);
  if (!Number.isInteger(refundOrders) || !Number.isInteger(restockableOrders) || refundOrders < 0 || restockableOrders < 0 || restockableOrders > refundOrders || refundOrders > project.deliveredOrders) return { ok: false, code: "INVALID_FINANCIAL_BASIS", message: "累计退款和可再次销售数量无效" };
  if (project.productKind === "DIGITAL" && restockableOrders !== 0) return { ok: false, code: "INVALID_FINANCIAL_BASIS", message: "数字商品没有可恢复的实体库存" };
  const previousRefunded = Number(project.refundedOrders || 0);
  const previousRestocked = Number(project.restockedOrders || 0);
  const refundDelta = refundOrders - previousRefunded;
  const restockDelta = restockableOrders - previousRestocked;
  if (refundDelta < 0 || restockDelta < 0 || restockDelta > refundDelta) return { ok: false, code: "INVALID_FINANCIAL_BASIS", message: "累计退款不得倒退，且新增入库不能超过本次退款商品" };
  if (refundDelta === 0 && restockDelta === 0) return { ok: false, code: "NO_CHANGE", message: "累计退款状态没有变化" };

  const refundJpy = BigInt(project.unitPriceJpy) * BigInt(refundDelta);
  const restockValue = BigInt(project.unitProductionCostJpy) * BigInt(restockDelta);
  if (isCompanyLed(project)) {
    const restricted = BigInt(project.companyLedger.restrictedCashJpy || 0);
    const fromRestricted = restricted < refundJpy ? restricted : refundJpy;
    const companyShortfall = refundJpy - fromRestricted;
    project.companyLedger.restrictedCashJpy = String(restricted - fromRestricted);
    if (refundJpy > 0n) pushCompanyJournal(project, {
      id: `company_journal_${transactionId}`,
      date,
      sourceId: project.id,
      originalTransactionId: `presale_${project.id}`,
      lines: [
        { account: "REFUND_CONTRA_REVENUE", debit: String(refundJpy), credit: "0" },
        { account: "COMPANY_CASH_RESTRICTED", debit: "0", credit: String(fromRestricted) },
        ...(companyShortfall > 0n ? [{ account: "COMPANY_PROJECT_FUNDING", debit: "0", credit: String(companyShortfall) }] : []),
      ],
    });
    if (restockValue > 0n) {
      addMoney(project.companyLedger, "inventoryValueJpy", restockValue);
      pushCompanyJournal(project, { id: `company_journal_${transactionId}_restock`, date, sourceId: project.id, originalTransactionId: `presale_${project.id}`, lines: [{ account: "COMPANY_INVENTORY", debit: String(restockValue), credit: "0" }, { account: "COMPANY_COGS", debit: "0", credit: String(restockValue) }] });
    }
  } else {
    const restricted = BigInt(project.restrictedBalanceJpy || 0);
    const fromRestricted = restricted < refundJpy ? restricted : refundJpy;
    const afterRestricted = refundJpy - fromRestricted;
    const free = BigInt(state.cash.free);
    const fromFree = free < afterRestricted ? free : afterRestricted;
    const payable = afterRestricted - fromFree;
    project.restrictedBalanceJpy = String(restricted - fromRestricted);
    state.cash.restricted = String(BigInt(state.cash.restricted) - fromRestricted);
    state.cash.free = String(free - fromFree);
    addMoney(state.cash, "payable", payable);
    addMoney(state.liabilities, "refundPayable", payable);
    addMoney(project, "refundPayableJpy", payable);
    state.finance.merchFulfilledRevenue = String(BigInt(state.finance.merchFulfilledRevenue) - refundJpy);
    if (refundJpy > 0n) pushJournal(state, {
      id: `journal_${transactionId}`,
      date,
      sourceId: project.id,
      originalTransactionId: `presale_${project.id}`,
      lines: [
        { account: "REFUND_CONTRA_REVENUE", debit: String(refundJpy), credit: "0" },
        { account: "CASH_RESTRICTED", debit: "0", credit: String(fromRestricted) },
        { account: "CASH_FREE", debit: "0", credit: String(fromFree) },
        { account: "REFUND_PAYABLE", debit: "0", credit: String(payable) },
      ],
    });
    if (restockValue > 0n) pushJournal(state, { id: `journal_${transactionId}_restock`, date, sourceId: project.id, originalTransactionId: `presale_${project.id}`, lines: [{ account: "INVENTORY", debit: String(restockValue), credit: "0" }, { account: "COGS", debit: "0", credit: String(restockValue) }] });
  }

  project.refundedOrders = refundOrders;
  project.restockedOrders = restockableOrders;
  addMoney(project, "postDeliveryRefundJpy", refundJpy);
  project.inventoryQuantity += restockDelta;
  addMoney(project, "inventoryValueJpy", restockValue);
  project.costs.cogsJpy = String(BigInt(project.costs.cogsJpy) - restockValue);
  project.lastActionAt = date;
  const refund = { id: transactionId, projectId, originalTransactionId: `presale_${project.id}`, date, cumulativeRefundOrders: refundOrders, refundOrderDelta: refundDelta, cumulativeRestockableOrders: restockableOrders, restockOrderDelta: restockDelta, refundJpy: String(refundJpy), restockValueJpy: String(restockValue), payer: project.fundingParty, playerImpactJpy: isCompanyLed(project) ? "0" : String(refundJpy) };
  state.history.merchPostDeliveryRefunds.push(refund);
  state.snapshotVersion += 1;
  return { ok: true, state, project, refund };
}

export function payMerchRefundPayable(sourceState, { projectId, amountJpy, date }) {
  const context = projectResult(sourceState, projectId, ["AFTER_SALES", "CANCELLED"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (isCompanyLed(project)) return { ok: false, code: "REQUIREMENT_UNMET", message: "公司项目退款不进入个人应付款" };
  const amount = BigInt(amountJpy || 0);
  const payable = BigInt(project.refundPayableJpy || 0);
  if (amount <= 0n || amount > payable) return { ok: false, code: "INVALID_FINANCIAL_BASIS", message: "还款金额必须大于 0 且不超过该项目退款应付款" };
  if (amount > BigInt(state.cash.free)) return { ok: false, code: "INSUFFICIENT_FREE_CASH", message: "自由现金不足，不能使用履约受限资金支付退款" };
  state.cash.free = String(BigInt(state.cash.free) - amount);
  state.cash.payable = String(BigInt(state.cash.payable) - amount);
  state.liabilities.refundPayable = String(BigInt(state.liabilities.refundPayable) - amount);
  project.refundPayableJpy = String(payable - amount);
  const settlement = { id: `merch_refund_payable_${project.id}_${state.snapshotVersion + 1}`, type: "MERCH", projectId, date, amountJpy: String(amount), remainingJpy: project.refundPayableJpy };
  state.history.payableSettlements.push(settlement);
  pushJournal(state, { id: `journal_${settlement.id}`, date, sourceId: project.id, lines: [{ account: "REFUND_PAYABLE", debit: String(amount), credit: "0" }, { account: "CASH_FREE", debit: "0", credit: String(amount) }] });
  state.snapshotVersion += 1;
  return { ok: true, state, project, settlement };
}

export function settleMerchProject(sourceState, { projectId, date }) {
  const context = projectResult(sourceState, projectId, ["AFTER_SALES"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (compareIso(date, project.afterSalesEndDate) < 0) return { ok: false, code: "WAITING_PERIOD", message: `售后窗口将在 ${project.afterSalesEndDate} 结束` };
  if (isCompanyLed(project)) {
    if (BigInt(project.companyLedger.deferredCustomerFundsJpy || 0) !== 0n) return { ok: false, code: "OUTSTANDING_LIABILITY", message: "公司项目仍有客户预付款，不能结项" };
    const profit = BigInt(project.fulfilledRevenueJpy) - BigInt(project.postDeliveryRefundJpy || 0) - BigInt(project.costs.fixedJpy) - BigInt(project.costs.storeFeeJpy) - BigInt(project.costs.cogsJpy) - BigInt(project.costs.cancellationJpy);
    const positiveProfit = profit > 0n ? profit : 0n;
    const royalty = positiveProfit * BigInt(project.royaltyBps) / 10000n;
    const release = BigInt(project.companyLedger.restrictedCashJpy || 0);
    project.companyLedger.restrictedCashJpy = "0";
    if (release > 0n) pushCompanyJournal(project, { id: `company_journal_${project.id}_release`, date, sourceId: project.id, lines: [{ account: "COMPANY_CASH_FREE", debit: String(release), credit: "0" }, { account: "COMPANY_CASH_RESTRICTED", debit: "0", credit: String(release) }] });
    project.projectProfitJpy = String(profit);
    project.royaltyJpy = String(royalty);
    project.status = "SETTLED";
    project.settledAt = date;
    project.lastActionAt = date;
    if (royalty > 0n) {
      const transactionId = `royalty_${project.id}`;
      const dueDate = addDays(date, BALANCE.contracts.corporatePlatformDelayDays);
      addMoney(state.cash, "receivable", royalty);
      addMoney(state.finance, "royaltyCreatorEarned", royalty);
      state.history.royaltyTransactions.push({ id: transactionId, projectId: project.id, date, dueDate, projectGrossJpy: project.grossOrdersJpy, projectProfitJpy: String(profit), royaltyBps: project.royaltyBps, royaltyJpy: String(royalty), debtor: project.fundingParty, contractSnapshot: structuredClone(project.contractSnapshot) });
      state.history.receivables.push({ id: `receivable_${transactionId}`, originalTransactionId: transactionId, type: "ROYALTY", debtor: project.fundingParty, amountJpy: String(royalty), receivedJpy: "0", adjustedJpy: "0", dueDate, status: "OPEN", contractId: project.contractSnapshotId });
      pushJournal(state, { id: `journal_${transactionId}`, date, sourceId: project.id, originalTransactionId: transactionId, lines: [{ account: "RECEIVABLE", debit: String(royalty), credit: "0", contractId: project.contractSnapshotId }, { account: "ROYALTY", debit: "0", credit: String(royalty), contractId: project.contractSnapshotId }] });
    }
    state.snapshotVersion += 1;
    return { ok: true, state, project, releasedJpy: "0", royaltyJpy: String(royalty) };
  }
  if (BigInt(project.deferredCustomerFundsJpy) !== 0n || BigInt(project.refundPayableJpy || 0) !== 0n) return { ok: false, code: "OUTSTANDING_LIABILITY", message: "该项目仍有客户预付款或退款应付款，不能结项" };
  const release = BigInt(project.restrictedBalanceJpy);
  project.restrictedBalanceJpy = "0";
  state.cash.restricted = String(BigInt(state.cash.restricted) - release);
  addMoney(state.cash, "free", release);
  const profit = BigInt(project.fulfilledRevenueJpy) - BigInt(project.postDeliveryRefundJpy || 0) - BigInt(project.costs.fixedJpy) - BigInt(project.costs.storeFeeJpy) - BigInt(project.costs.cogsJpy) - BigInt(project.costs.cancellationJpy);
  project.projectProfitJpy = String(profit);
  addMoney(state.finance, "projectProfit", profit);
  project.status = "SETTLED";
  project.settledAt = date;
  project.lastActionAt = date;
  if (release > 0n) pushJournal(state, { id: `journal_${project.id}_release`, date, sourceId: project.id, lines: [{ account: "CASH_FREE", debit: String(release), credit: "0" }, { account: "CASH_RESTRICTED", debit: "0", credit: String(release) }] });
  state.snapshotVersion += 1;
  return { ok: true, state, project, releasedJpy: String(release) };
}

export function cancelMerchProject(sourceState, { projectId, date, reason = "PLAYER_CANCELLED" }) {
  const context = projectResult(sourceState, projectId, ["DRAFT", "DESIGNING", "SAMPLING", "READY_TO_SELL", "ON_SALE", "SALES_CLOSED", "PRODUCING", "READY_TO_SHIP", "FULFILLING"]);
  if (context.error) return context.error;
  const { state, project } = context;
  if (isCompanyLed(project)) {
    const refund = BigInt(project.companyLedger.deferredCustomerFundsJpy || 0);
    const restricted = BigInt(project.companyLedger.restrictedCashJpy || 0);
    const fromRestricted = restricted < refund ? restricted : refund;
    const companyShortfall = refund - fromRestricted;
    project.companyLedger.restrictedCashJpy = String(restricted - fromRestricted);
    project.companyLedger.deferredCustomerFundsJpy = "0";
    if (refund > 0n) pushCompanyJournal(project, { id: `company_journal_${project.id}_refund`, date, sourceId: project.id, lines: [{ account: "COMPANY_DEFERRED_CUSTOMER_FUNDS", debit: String(refund), credit: "0" }, { account: "COMPANY_CASH_RESTRICTED", debit: "0", credit: String(fromRestricted) }, ...(companyShortfall > 0n ? [{ account: "COMPANY_PROJECT_FUNDING", debit: "0", credit: String(companyShortfall) }] : [])] });
    const prepayment = BigInt(project.productionPrepaymentJpy || 0);
    if (prepayment > 0n) {
      project.productionPrepaymentJpy = "0";
      project.companyLedger.productionPrepaymentJpy = "0";
      project.costs.cancellationJpy = String(BigInt(project.costs.cancellationJpy) + prepayment);
      pushCompanyJournal(project, { id: `company_journal_${project.id}_writeoff`, date, sourceId: project.id, lines: [{ account: "OTHER_EXPLICIT_COST", debit: String(prepayment), credit: "0" }, { account: "PRODUCTION_PREPAYMENT", debit: "0", credit: String(prepayment) }] });
    }
    if (project.salesMode === "READY_STOCK" && project.reservedInventoryQuantity > 0) {
      project.inventoryQuantity += project.reservedInventoryQuantity;
      project.reservedInventoryQuantity = 0;
    }
    project.status = "CANCELLED";
    project.cancelledAt = date;
    project.lastActionAt = date;
    project.cancellationTreatment = { reason, payer: project.fundingParty, refundJpy: String(refund), cashRestrictedJpy: String(fromRestricted), companyShortfallJpy: String(companyShortfall), playerImpactJpy: "0", writtenOffProductionJpy: String(prepayment), materialResidualJpy: project.inventoryValueJpy || "0" };
    state.history.merchRefunds.push({ id: `merch_refund_${project.id}_${state.snapshotVersion + 1}`, projectId, originalTransactionId: `presale_${project.id}`, date, amountJpy: String(refund), payableJpy: "0", payer: project.fundingParty, playerImpactJpy: "0" });
    state.snapshotVersion += 1;
    return { ok: true, state, project };
  }
  const refund = BigInt(project.deferredCustomerFundsJpy || 0);
  const restricted = BigInt(project.restrictedBalanceJpy || 0);
  const fromRestricted = restricted < refund ? restricted : refund;
  const afterRestricted = refund - fromRestricted;
  const free = BigInt(state.cash.free);
  const fromFree = free < afterRestricted ? free : afterRestricted;
  const payable = afterRestricted - fromFree;
  project.restrictedBalanceJpy = String(restricted - fromRestricted);
  state.cash.restricted = String(BigInt(state.cash.restricted) - fromRestricted);
  state.cash.free = String(free - fromFree);
  state.cash.payable = String(BigInt(state.cash.payable) + payable);
  addMoney(state.liabilities, "refundPayable", payable);
  project.refundPayableJpy = String(payable);
  state.liabilities.deferredCustomerFunds = String(BigInt(state.liabilities.deferredCustomerFunds) - refund);
  project.deferredCustomerFundsJpy = "0";
  if (refund > 0n) {
    pushJournal(state, { id: `journal_${project.id}_refund`, date, sourceId: project.id, lines: [{ account: "DEFERRED_CUSTOMER_FUNDS", debit: String(refund), credit: "0" }, { account: "CASH_RESTRICTED", debit: "0", credit: String(fromRestricted) }, { account: "CASH_FREE", debit: "0", credit: String(fromFree) }, { account: "REFUND_PAYABLE", debit: "0", credit: String(payable) }] });
  }
  const prepayment = BigInt(project.productionPrepaymentJpy || 0);
  if (prepayment > 0n) {
    project.productionPrepaymentJpy = "0";
    project.costs.cancellationJpy = String(BigInt(project.costs.cancellationJpy) + prepayment);
    pushJournal(state, { id: `journal_${project.id}_writeoff`, date, sourceId: project.id, lines: [{ account: "OTHER_EXPLICIT_COST", debit: String(prepayment), credit: "0" }, { account: "PRODUCTION_PREPAYMENT", debit: "0", credit: String(prepayment) }] });
  }
  if (project.salesMode === "READY_STOCK" && project.reservedInventoryQuantity > 0) {
    project.inventoryQuantity += project.reservedInventoryQuantity;
    project.reservedInventoryQuantity = 0;
  }
  project.status = "CANCELLED";
  project.cancelledAt = date;
  project.lastActionAt = date;
  project.cancellationTreatment = { reason, refundJpy: String(refund), cashRestrictedJpy: String(fromRestricted), cashFreeJpy: String(fromFree), refundPayableJpy: String(payable), writtenOffProductionJpy: String(prepayment), materialResidualJpy: project.inventoryValueJpy || "0" };
  state.history.merchRefunds.push({ id: `merch_refund_${project.id}_${state.snapshotVersion + 1}`, projectId, originalTransactionId: `presale_${project.id}`, date, amountJpy: String(refund), payableJpy: String(payable) });
  state.snapshotVersion += 1;
  return { ok: true, state, project };
}
