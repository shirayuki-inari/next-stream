import test from "node:test";
import assert from "node:assert/strict";
import { createGame, migrateGame, settleWeek, updatePlan } from "../src/domain/engine.js";
import { processDueReceivables } from "../src/domain/finance.js";
import { acceptSponsorship, refreshSponsorOffer, sponsorCandidateMetrics } from "../src/domain/sponsorship.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game(routeId = "indie", seed = "sponsor-seed") {
  return migrateGame(createGame({ mode: "direct", routeId, performerCode: "SPN", characterName: "交付信号", primaryLanguage: "jp", primaryDirection: "game", careerGoal: "livelihood", seed, abilities }));
}

function addCandidateHistory(state, views = [1000]) {
  state.history.contents.push(...views.map((uniqueEstimate, index) => ({
    id: `candidate_${index}`,
    type: "VIDEO",
    visibility: "PUBLIC",
    publishedAt: `2026-09-${String(10 + index).padStart(2, "0")}`,
    uniqueEstimate,
  })));
}

function assertBalanced(state) {
  for (const entry of state.history.journalEntries) {
    const debit = entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n);
    const credit = entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n);
    assert.equal(debit, credit, entry.id);
  }
}

test("sponsor candidate uses a real 28-day average, reputation, contract permission, and capped template quote", () => {
  const state = game();
  addCandidateHistory(state, [800, 1200]);
  assert.deepEqual(sponsorCandidateMetrics(state, "2026-09-14"), {
    eligible: true,
    averageViews: 1000,
    workReputation: 50,
    contentCount: 2,
    categoryMatch: true,
    contractAllowed: true,
  });
  const offer = refreshSponsorOffer(state, "2026-09-14");
  assert.equal(offer.quoteJpy, "19000");
  assert.equal(offer.status, "OPEN");

  const corporate = game("homolive", "sponsor-permission");
  addCandidateHistory(corporate, [100000]);
  corporate.contract.sponsorshipAllowed = false;
  assert.equal(sponsorCandidateMetrics(corporate, "2026-09-14").eligible, false);
  corporate.contract.sponsorshipAllowed = true;
  assert.equal(refreshSponsorOffer(corporate, "2026-09-14").quoteJpy, "250000");
});

test("personal sponsorship keeps 30% upfront restricted, then recognizes delivery and a 14-day final receivable", async () => {
  let state = game("indie", "sponsor-indie");
  addCandidateHistory(state);
  const offer = refreshSponsorOffer(state, "2026-09-14");
  const accepted = acceptSponsorship(state, offer.id, "2026-09-14");
  assert.equal(accepted.ok, true);
  state = accepted.state;
  assert.equal(state.cash.free, "600000");
  assert.equal(state.cash.restricted, "5700");
  assert.equal(state.liabilities.deferredCustomerFunds, "5700");
  assert.equal(state.finance.sponsorCreatorEarned, "0");
  assert.equal(state.finance.sponsorCreatorReceived, "5700");
  assert.equal(state.sponsorships[0].reviewNodes[0].status, "SCHEDULED");

  const planned = updatePlan(state, 0, "EDIT_VIDEO", { targetId: offer.id });
  assert.equal(planned.ok, true);
  const settled = await settleWeek(planned.state);
  assert.equal(settled.ok, true);
  const deal = settled.state.sponsorships[0];
  assert.equal(deal.status, "DELIVERED");
  assert.equal(deal.reviewNodes[0].status, "APPROVED_AT_DELIVERY");
  assert.equal(settled.state.cash.restricted, "0");
  assert.equal(settled.state.liabilities.deferredCustomerFunds, "0");
  assert.equal(settled.state.finance.sponsorGross, "19000");
  assert.equal(settled.state.finance.sponsorCreatorEarned, "19000");
  assert.equal(settled.state.cash.receivable, "13300");
  assert.equal(settled.state.history.receivables.at(-1).dueDate, "2026-09-28");

  assert.equal(processDueReceivables(settled.state, "2026-09-27"), 0n);
  assert.equal(processDueReceivables(settled.state, "2026-09-28"), 13300n);
  assert.equal(settled.state.finance.sponsorCreatorReceived, "19000");
  assertBalanced(settled.state);
});

test("company-led sponsorship records only the creator's 70% share in personal cash and receivable", async () => {
  let state = game("homolive", "sponsor-corporate");
  addCandidateHistory(state);
  const offer = refreshSponsorOffer(state, "2026-09-14");
  state = acceptSponsorship(state, offer.id, "2026-09-14").state;
  assert.equal(state.cash.restricted, "0");
  assert.equal(state.liabilities.deferredCustomerFunds, "0");

  state = updatePlan(state, 0, "EDIT_VIDEO", { targetId: offer.id }).state;
  const settled = await settleWeek(state);
  assert.equal(settled.ok, true);
  assert.equal(settled.state.finance.sponsorGross, "19000");
  assert.equal(settled.state.finance.sponsorCreatorEarned, "13300");
  assert.equal(settled.state.cash.receivable, "13300");
  assert.equal(settled.state.cash.restricted, "0");
  assert.equal(settled.state.history.receivables.at(-1).debtor, "agency_homolive");
  assertBalanced(settled.state);
});

test("a sponsorship target cannot be attached to the wrong activity", () => {
  let state = game();
  addCandidateHistory(state);
  const offer = refreshSponsorOffer(state, "2026-09-14");
  state = acceptSponsorship(state, offer.id, "2026-09-14").state;
  const invalid = updatePlan(state, 0, "LIVE_GAME", { targetId: offer.id });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "CONTRACT_CONFLICT");
});
