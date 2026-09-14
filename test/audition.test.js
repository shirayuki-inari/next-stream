import test from "node:test";
import assert from "node:assert/strict";
import { acknowledgeReport, createGame, settleWeek, updatePlan } from "../src/domain/engine.js";
import {
  acceptAuditionContractReview,
  auditionEligibility,
  auditionScore,
  beginAuditionContractReview,
  completeAudition,
  createAuditionApplication,
  resolveAuditionScreening,
  startAuditionScreening,
  submitAuditionApplication,
} from "../src/domain/audition.js";

const balanced = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game(seed = "audition", options = {}) {
  return createGame({ mode: options.mode || "history", routeId: options.routeId || "indie", performerCode: "AUDITION", characterName: "招募测试", primaryLanguage: "jp", primaryDirection: options.direction || "creative", careerGoal: "creator", seed, abilities: options.abilities || balanced });
}

function withWork(state, quality = 80) {
  state.history.contents.push({ id: `work_${state.seed}`, channelId: state.channel.id, type: "VIDEO", publishedAt: "2026-09-14", quality, visibility: "PUBLIC" });
  return state;
}

function unwrap(result) {
  assert.equal(result.ok, true, result.message);
  return result.state;
}

test("A-28 zero subscribers do not block an otherwise qualified audition application", async () => {
  let state = withWork(game("zero-subscriber"), 80);
  assert.equal(state.channel.subscribers, 0);
  const eligibility = auditionEligibility(state, "agency_homolive");
  assert.equal(eligibility.eligible, true);
  assert.equal("subscribers" in eligibility.checks, false);
  const scoreAtZero = auditionScore(state, "agency_homolive");
  const highSubscriberState = structuredClone(state);
  highSubscriberState.channel.subscribers = 1_000_000;
  assert.deepEqual(auditionScore(highSubscriberState, "agency_homolive"), scoreAtZero);
  state = unwrap(createAuditionApplication(state, { agencyId: "agency_homolive", date: "2026-09-14" }));
  state = unwrap(await submitAuditionApplication(state, { applicationId: state.auditionApplications[0].id, date: "2026-09-14" }));
  assert.equal(state.auditionApplications[0].status, "SUBMITTED");
  assert.equal(state.auditionApplications[0].eligibilitySnapshot.subscriberCountIgnored, 0);
  assert.equal(state.auditionRounds[0].backgroundCandidateScores.length, 3);
});

test("A-29 rejection retains the application and enforces a 12-week same-agency cooldown", async () => {
  const lowRelevant = { expression: 30, specialty: 30, performance: 70, production: 70, planning: 70, collaboration: 30 };
  let state = withWork(game("audition-cooldown", { direction: "music", abilities: lowRelevant }), 20);
  state = unwrap(createAuditionApplication(state, { agencyId: "agency_2434", date: "2026-09-14" }));
  const applicationId = state.auditionApplications[0].id;
  state = unwrap(await submitAuditionApplication(state, { applicationId, date: "2026-09-14" }));
  assert.equal(state.auditionApplications[0].scoreBreakdown.total < 50, true);
  state = unwrap(startAuditionScreening(state, { applicationId, date: "2026-09-14" }));
  state = unwrap(resolveAuditionScreening(state, { applicationId, date: "2026-09-14" }));
  assert.equal(state.auditionApplications[0].status, "REJECTED");
  assert.equal(state.auditionApplications[0].cooldownUntilWeek, 13);
  const blocked = createAuditionApplication(state, { agencyId: "agency_2434", date: "2026-09-15" });
  assert.equal(blocked.code, "AUDITION_COOLDOWN");
  assert.equal(state.auditionApplications.length, 1);
  state.weekIndex = 13;
  const allowed = createAuditionApplication(state, { agencyId: "agency_2434", date: "2026-12-07" });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.state.auditionApplications.length, 2);
});

test("interview preparation is schedule-bound, capped at eight, and final competition uses a fixed round", async () => {
  const stageAbilities = { expression: 30, specialty: 30, performance: 70, production: 70, planning: 70, collaboration: 30 };
  let state = withWork(game("audition-interviews", { direction: "music", abilities: stageAbilities }), 100);
  state.history.portfolioWorks.push({ id: "representative_song", assetId: "asset_song", kind: "MUSIC", publishedAt: "2026-09-13", evaluationScore: 100 });
  state = unwrap(createAuditionApplication(state, { agencyId: "agency_homolive", date: "2026-09-14" }));
  const applicationId = state.auditionApplications[0].id;
  state = unwrap(await submitAuditionApplication(state, { applicationId, date: "2026-09-14" }));
  const fixedCandidates = [...state.auditionRounds[0].backgroundCandidateScores];
  state = unwrap(startAuditionScreening(state, { applicationId, date: "2026-09-14" }));
  state = unwrap(resolveAuditionScreening(state, { applicationId, date: "2026-09-14" }));
  for (const slot of [0, 1, 2, 3]) state = unwrap(updatePlan(state, slot, "AUDITION_PREP", { targetId: applicationId, targetType: "AUDITION_APPLICATION" }));
  state = unwrap(updatePlan(state, 4, "AUDITION_TEST", { targetId: applicationId, targetType: "AUDITION_APPLICATION" }));
  state = unwrap(updatePlan(state, 6, "AUDITION_TEST", { targetId: applicationId, targetType: "AUDITION_APPLICATION" }));
  const invalidExtra = updatePlan(state, 7, "AUDITION_PREP", { targetId: applicationId, targetType: "AUDITION_APPLICATION" });
  assert.equal(invalidExtra.code, "INVALID_PLAN");
  const settled = await settleWeek(state);
  assert.equal(settled.ok, true);
  state = settled.state;
  const application = state.auditionApplications[0];
  assert.equal(application.interviewPrepModifier, 8);
  assert.equal(application.interviewTestsCompleted, 2);
  assert.equal(application.finalNoise >= -3 && application.finalNoise <= 3, true);
  assert.equal(application.status, "CONDITIONAL_OFFER");
  assert.deepEqual(state.auditionRounds[0].backgroundCandidateScores, fixedCandidates);
  state = unwrap(acknowledgeReport(state));
  state = unwrap(beginAuditionContractReview(state, { applicationId, date: "2026-09-21" }));
  state = unwrap(acceptAuditionContractReview(state, { applicationId, date: "2026-09-21" }));
  state = unwrap(completeAudition(state, { applicationId, date: "2026-09-21" }));
  assert.equal(state.auditionApplications[0].status, "COMPLETED");
  assert.equal(state.auditionApplications[0].transferEligibility.granted, true);
  assert.equal(state.affiliation.agencyId, null);
});

test("current agency cannot be applied to again and an external application requires contract permission", () => {
  let state = withWork(game("same-agency", { routeId: "homolive", mode: "direct" }));
  assert.equal(createAuditionApplication(state, { agencyId: "agency_homolive", date: "2026-09-14" }).code, "REQUIREMENT_UNMET");
  state.contract.allowsExternalAuditions = false;
  const eligibility = auditionEligibility(state, "agency_2434");
  assert.equal(eligibility.checks.contract, false);
  assert.equal(eligibility.eligible, false);
});
