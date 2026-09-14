import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuality, createGame, settleWeek, updatePlan } from "../src/domain/engine.js";
import { acceptAuditionContractReview, createAuditionApplication, resolveAuditionScreening, startAuditionScreening, submitAuditionApplication } from "../src/domain/audition.js";
import { openTextEvent } from "../src/domain/events.js";
import { createMerchProject } from "../src/domain/merch.js";
import { createTransferCase } from "../src/domain/transfers.js";
import { EVENT_TEMPLATE_BY_ID, EVENT_TEMPLATES } from "../rules/event_templates.js";

const balanced = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game(seed = "acceptance", options = {}) {
  return createGame({ mode: options.mode || "direct", routeId: options.routeId || "indie", performerCode: "P0", characterName: "验收角色", primaryLanguage: "jp", primaryDirection: options.direction || "creative", careerGoal: "creator", seed, abilities: options.abilities || balanced });
}

function unwrap(result) {
  assert.equal(result.ok, true, `${result.code || "UNKNOWN"}: ${result.message || ""}`);
  return result.state;
}

test("G-06 stable returning viewers remain an estimate and never become copied subscribers", () => {
  const oldActive = 20_000;
  const stableReturning = Math.floor(oldActive * 0.6 * 0.65 * 0.8);
  assert.equal(stableReturning, 6_240);
  const state = game("g06");
  state.metrics.active28dEstimate = oldActive;
  assert.equal(state.channel.subscribers, 0);
});

test("G-07 free cash and restricted presale cash remain separate buckets", () => {
  const openingFree = 300_000n;
  const oldReceivableArrival = 50_000n;
  const payment = 30_000n;
  const newPresale = 250_000n;
  const free = openingFree + oldReceivableArrival - payment;
  const restricted = newPresale;
  assert.equal(free, 320_000n);
  assert.equal(restricted, 250_000n);
  assert.notEqual(free, 570_000n);
});

test("A-02 a first history-mode rejection retains abilities, cash, and existing content", async () => {
  const abilities = { expression: 70, specialty: 70, performance: 30, production: 30, planning: 30, collaboration: 70 };
  let state = game("history-rejection", { mode: "history", abilities });
  for (const relationship of state.relationships) relationship.workTrust = 0;
  state.history.contents.push({ id: "history_work", channelId: state.channel.id, type: "VIDEO", actionId: "EDIT_VIDEO", publishedAt: "2026-09-14", quality: 0, visibility: "PUBLIC", uniqueEstimate: 20, watchMinutes: 20, subscriberDelta: 0 });
  const retained = { abilities: structuredClone(state.performer.abilities), cash: structuredClone(state.cash), contents: structuredClone(state.history.contents) };
  state = unwrap(createAuditionApplication(state, { agencyId: "agency_homolive", date: "2026-09-14" }));
  const applicationId = state.auditionApplications[0].id;
  state = unwrap(await submitAuditionApplication(state, { applicationId, date: "2026-09-14" }));
  state = unwrap(startAuditionScreening(state, { applicationId, date: "2026-09-15" }));
  state = unwrap(resolveAuditionScreening(state, { applicationId, date: "2026-09-16" }));
  assert.equal(state.auditionApplications[0].status, "REJECTED");
  assert.equal(state.phase, "PLANNING");
  assert.deepEqual(state.performer.abilities, retained.abilities);
  assert.deepEqual(state.cash, retained.cash);
  assert.deepEqual(state.history.contents, retained.contents);
});

test("A-08 bounded noise changes quality within the declared range without a standalone disaster", () => {
  const common = { related: 60, preparation: 60, match: 70, production: 50, fatigue: 0, stress: 0, physicalCondition: 100, choiceDelta: 0 };
  const low = calculateQuality({ ...common, noise: 0.94 }).quality;
  const high = calculateQuality({ ...common, noise: 1.06 }).quality;
  assert.equal(Number(low.toFixed(3)), 56.87);
  assert.equal(Number(high.toFixed(3)), 64.13);
  assert.ok(low > 50 && high < 70);
});

test("A-09 mismatched launch content can receive exposure without converting every viewer or forcing loyalty growth", async () => {
  let state = game("mismatch-exposure", { routeId: "homolive", direction: "game" });
  const beforeLoyalty = state.audienceSegments.find((item) => item.preference === "music" && item.language === "jp").loyalty;
  state = unwrap(updatePlan(state, 0, "LIVE_MUSIC"));
  const settled = await settleWeek(state);
  assert.equal(settled.ok, true);
  const content = settled.report.contents[0];
  assert.ok(content.uniqueEstimate > 0);
  assert.ok(content.subscriberDelta < content.uniqueEstimate);
  const afterLoyalty = settled.state.audienceSegments.find((item) => item.preference === "music" && item.language === "jp").loyalty;
  assert.ok(afterLoyalty <= beforeLoyalty + 3);
});

test("E-04 a pending event survives JSON refresh with the same stable ID and option set", () => {
  const template = EVENT_TEMPLATES.find((item) => !item.followUp) || EVENT_TEMPLATES[0];
  const opened = openTextEvent(game("event-refresh"), template.id);
  assert.equal(opened.ok, true);
  const restored = JSON.parse(JSON.stringify(opened.state));
  const event = restored.textEvents.find((item) => item.id === opened.event.id);
  assert.equal(event.templateId, template.id);
  assert.equal(event.status, "PENDING");
  assert.deepEqual(EVENT_TEMPLATE_BY_ID[event.templateId].choices.map((item) => item.id), template.choices.map((item) => item.id));
});

test("E-05 project and transfer mutations reject the running phase", () => {
  const state = game("invalid-phase");
  state.phase = "RUNNING";
  assert.equal(createMerchProject(state, { date: "2026-09-14" }).code, "INVALID_PHASE");
  assert.equal(createTransferCase(state, { targetRouteId: "homolive", date: "2026-09-14" }).code, "INVALID_PHASE");
  assert.equal(acceptAuditionContractReview(state, { applicationId: "missing", date: "2026-09-14" }).code, "INVALID_PHASE");
});

test("E-07 narration-only text changes leave numeric, random, and financial settlement identical", async () => {
  let left = game("narration-independent");
  let right = game("narration-independent");
  right.textEvents[0].title = "仅修改的旁白标题";
  left = unwrap(updatePlan(left, 0, "LIVE_GAME"));
  right = unwrap(updatePlan(right, 0, "LIVE_GAME"));
  const [leftResult, rightResult] = await Promise.all([settleWeek(left), settleWeek(right)]);
  assert.equal(leftResult.ok, true);
  assert.equal(rightResult.ok, true);
  assert.deepEqual(leftResult.state.metrics, rightResult.state.metrics);
  assert.deepEqual(leftResult.state.cash, rightResult.state.cash);
  assert.deepEqual(leftResult.state.finance, rightResult.state.finance);
  assert.deepEqual(leftResult.report.contents, rightResult.report.contents);
});
