import { ROUTES } from "../../rules/agency_profiles.js";
import { BALANCE } from "../../rules/balance_standard_0_1.js";

const SPONSOR = BALANCE.sponsorship;

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function compareIso(a, b) {
  return String(a).localeCompare(String(b));
}

function pushJournal(state, entry) {
  const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n);
  const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n);
  if (debit !== credit) throw new Error("INVALID_FINANCIAL_BASIS");
  state.history.journalEntries.push(entry);
}

function addMoney(target, key, amount) {
  target[key] = String(BigInt(target[key] || 0) + BigInt(amount));
}

function recentContent(state, date) {
  const cutoff = addDays(date, -27);
  return state.history.contents.filter((content) => content.visibility === "PUBLIC" && compareIso(content.publishedAt, cutoff) >= 0 && compareIso(content.publishedAt, date) <= 0);
}

export function sponsorCandidateMetrics(state, date) {
  const contents = recentContent(state, date);
  const averageViews = contents.length ? Math.floor(contents.reduce((sum, content) => sum + content.uniqueEstimate, 0) / contents.length) : 0;
  const categoryMatch = true;
  const contractAllowed = !state.contract || (state.contract.signed === true && state.contract.sponsorshipAllowed !== false);
  return {
    eligible: averageViews >= SPONSOR.minimumAverageViews28d && state.performer.workReputation >= SPONSOR.minimumWorkReputation && categoryMatch && contractAllowed,
    averageViews,
    workReputation: state.performer.workReputation,
    contentCount: contents.length,
    categoryMatch,
    contractAllowed,
  };
}

export function refreshSponsorOffer(state, date) {
  for (const deal of state.sponsorships) {
    if (deal.status === "OPEN" && compareIso(deal.expiresAt, date) < 0) deal.status = "OFFER_EXPIRED";
  }
  if (state.sponsorships.some((deal) => ["OPEN", "ACCEPTED"].includes(deal.status))) return null;
  const latest = state.sponsorships.at(-1);
  if (latest && state.weekIndex - latest.weekIndex < SPONSOR.offerCooldownWeeks) return null;
  const metrics = sponsorCandidateMetrics(state, date);
  if (!metrics.eligible) return null;
  const brandFit = state.performer.primaryDirection === "creative" ? 0.9 : 0.82;
  const rawQuote = SPONSOR.baseQuoteJpy + SPONSOR.perAverageViewJpy * metrics.averageViews + SPONSOR.brandFitBonusJpy * brandFit;
  const quoteJpy = Math.min(SPONSOR.quoteCapJpy, Math.floor(rawQuote / 1000) * 1000);
  const offer = {
    id: `sponsor_offer_w${state.weekIndex}_${state.performer.primaryDirection}`,
    weekIndex: state.weekIndex,
    brandName: "北极星工具研究所",
    category: state.performer.primaryDirection,
    brandFit,
    averageViewsBasis: metrics.averageViews,
    quoteJpy: String(quoteJpy),
    deliverables: 1,
    usageLicense: "频道内公开内容与品牌官方社交账号 30 日引用",
    offeredAt: date,
    expiresAt: addDays(date, SPONSOR.offerValidityDays),
    status: "OPEN",
    reviewNodes: [],
    cancellationTerms: {
      beforeDraft: "预付款全额退回，未发生制作费不计入收入",
      afterReview: "保留已发生的明确制作成本，其余预付款退回",
    },
    sourceType: "DESIGN_VALUE",
  };
  state.sponsorships.push(offer);
  return offer;
}

export function acceptSponsorship(sourceState, offerId, date) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "仅能在计划阶段接受商单" };
  const state = structuredClone(sourceState);
  const offer = state.sponsorships.find((item) => item.id === offerId);
  if (!offer || offer.status !== "OPEN" || compareIso(offer.expiresAt, date) < 0) return { ok: false, code: "CONTRACT_CONFLICT", message: "商单报价已失效或不可接受" };
  offer.status = "ACCEPTED";
  offer.acceptedAt = date;
  offer.dueDate = addDays(date, SPONSOR.deliveryDays);
  offer.reviewNodes = [{ id: `review_${offer.id}_draft`, status: "SCHEDULED", dueDate: addDays(date, SPONSOR.reviewLeadDays), revisionsAllowed: 1, sourceType: "DESIGN_VALUE" }];
  offer.contractSnapshot = {
    routeId: state.routeId,
    contractId: state.contract?.id || null,
    creatorShareBps: state.routeId === "indie" ? 10000 : BALANCE.contracts.corporateSponsorCreatorShareBps,
    upfrontBps: state.routeId === "indie" ? SPONSOR.personalUpfrontBps : 0,
  };
  const upfront = BigInt(offer.quoteJpy) * BigInt(offer.contractSnapshot.upfrontBps) / 10000n;
  offer.upfrontJpy = String(upfront);
  if (upfront > 0n) {
    addMoney(state.cash, "restricted", upfront);
    addMoney(state.liabilities, "deferredCustomerFunds", upfront);
    addMoney(state.finance, "sponsorCreatorReceived", upfront);
    pushJournal(state, {
      id: `journal_sponsor_upfront_${offer.id}`,
      date,
      sourceId: offer.id,
      lines: [
        { account: "CASH_RESTRICTED", debit: String(upfront), credit: "0", contractId: state.contract?.id || null },
        { account: "DEFERRED_CUSTOMER_FUNDS", debit: "0", credit: String(upfront), contractId: state.contract?.id || null },
      ],
    });
  }
  state.snapshotVersion += 1;
  return { ok: true, state };
}

export function fulfillSponsorship(state, dealId, content) {
  if (!dealId) return null;
  const deal = state.sponsorships.find((item) => item.id === dealId);
  if (!deal || deal.status !== "ACCEPTED") throw new Error("CONTRACT_CONFLICT");
  const quote = BigInt(deal.quoteJpy);
  const upfront = BigInt(deal.upfrontJpy || 0);
  const creatorTotal = quote * BigInt(deal.contractSnapshot.creatorShareBps) / 10000n;
  const receivableAmount = creatorTotal - upfront;
  const dueDate = addDays(content.publishedAt, SPONSOR.finalPaymentDays);
  deal.status = "DELIVERED";
  deal.deliveredAt = content.publishedAt;
  deal.contentId = content.id;
  deal.creatorEarnedJpy = String(creatorTotal);
  deal.finalReceivableJpy = String(receivableAmount);
  deal.paymentDueDate = dueDate;
  for (const review of deal.reviewNodes || []) {
    review.status = "APPROVED_AT_DELIVERY";
    review.resolvedAt = content.publishedAt;
  }
  if (upfront > 0n) {
    state.liabilities.deferredCustomerFunds = String(BigInt(state.liabilities.deferredCustomerFunds) - upfront);
    state.cash.restricted = String(BigInt(state.cash.restricted) - upfront);
    addMoney(state.cash, "free", upfront);
  }
  if (receivableAmount > 0n) {
    addMoney(state.cash, "receivable", receivableAmount);
    state.history.receivables.push({ id: `receivable_sponsor_${deal.id}`, originalTransactionId: deal.id, type: "SPONSOR", debtor: state.routeId === "indie" ? deal.brandName : ROUTES[state.routeId].agencyId, amountJpy: String(receivableAmount), receivedJpy: "0", adjustedJpy: "0", dueDate, status: "OPEN", contractId: deal.contractSnapshot.contractId });
  }
  addMoney(state.finance, "sponsorGross", quote);
  addMoney(state.finance, "sponsorCreatorEarned", creatorTotal);
  pushJournal(state, {
    id: `journal_sponsor_delivery_${deal.id}`,
    date: content.publishedAt,
    sourceId: deal.id,
    lines: [
      ...(upfront > 0n ? [{ account: "DEFERRED_CUSTOMER_FUNDS", debit: String(upfront), credit: "0", contractId: deal.contractSnapshot.contractId }] : []),
      ...(receivableAmount > 0n ? [{ account: "RECEIVABLE", debit: String(receivableAmount), credit: "0", contractId: deal.contractSnapshot.contractId }] : []),
      { account: "SPONSOR", debit: "0", credit: String(creatorTotal), contractId: deal.contractSnapshot.contractId },
    ],
  });
  if (upfront > 0n) {
    pushJournal(state, {
      id: `journal_sponsor_release_${deal.id}`,
      date: content.publishedAt,
      sourceId: deal.id,
      lines: [
        { account: "CASH_FREE", debit: String(upfront), credit: "0", contractId: deal.contractSnapshot.contractId },
        { account: "CASH_RESTRICTED", debit: "0", credit: String(upfront), contractId: deal.contractSnapshot.contractId },
      ],
    });
  }
  return { quoteJpy: String(quote), creatorEarnedJpy: String(creatorTotal), receivableJpy: String(receivableAmount), releasedUpfrontJpy: String(upfront) };
}
