import test from "node:test";
import assert from "node:assert/strict";
import { BALANCE } from "../rules/balance_standard_0_1.js";
import { createGame, settleWeek, updatePlan } from "../src/domain/engine.js";
import {
  advanceLongProjectTail,
  archiveLongProject,
  approveLongProject,
  cancelLongProject,
  createLongProject,
  enterLongProjectProduction,
  passLongProjectQuality,
  pauseLongProject,
  processLongProjectDate,
  publishLongProject,
  resumeLongProject,
  startLongProject,
  submitLongProject,
  applyLongProjectWork,
} from "../src/domain/projects.js";
import { requestAgencyResource, resolveAgencyResourceBatch } from "../src/domain/resources.js";

const balanced = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game(seed = "long-project", routeId = "indie") {
  return createGame({ mode: "direct", routeId, performerCode: "PROJECT", characterName: "项目测试", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed, abilities: balanced });
}

function unwrap(result) {
  assert.equal(result.ok, true, result.message);
  return result.state;
}

function startProduction(state, templateId, date = "2026-09-14") {
  state = unwrap(createLongProject(state, { templateId, date }));
  const projectId = state.projects.at(-1).id;
  state = unwrap(submitLongProject(state, { projectId, date }));
  if (state.projects.at(-1).status === "REVIEW") state = unwrap(approveLongProject(state, { projectId, date }));
  state = unwrap(startLongProject(state, { projectId, date }));
  state = unwrap(enterLongProjectProduction(state, { projectId, date }));
  return { state, projectId };
}

function finishProject(state, projectId, date) {
  const project = state.projects.find((item) => item.id === projectId);
  while (project.workCompleted < project.workRequired) applyLongProjectWork(state, projectId, date);
  state = unwrap(processLongProjectDate(state, { projectId, date: project.earliestPublishDate }));
  state = unwrap(passLongProjectQuality(state, { projectId, date: project.earliestPublishDate }));
  state = unwrap(publishLongProject(state, { projectId, date: project.earliestPublishDate }));
  return unwrap(advanceLongProjectTail(state, { projectId, date: project.earliestPublishDate }));
}

test("long-project templates preserve the four specification budgets, work units, calendar waits, and resources", () => {
  const templates = Object.values(BALANCE.longProjects);
  assert.deepEqual(templates.map((item) => [item.name, item.budgetJpy, item.workUnits, item.minimumCalendarDays]), [
    ["新衣装", 150000, 4, 28],
    ["翻唱／录音作品", 120000, 5, 21],
    ["原创曲", 350000, 8, 42],
    ["3D 周年企划", 600000, 12, 56],
  ]);
  assert.deepEqual(BALANCE.longProjects.originalSong.resourceRequirements.map((item) => [item.resourceType, item.quantity]), [["RECORDING_SLOT", 3], ["SONG_PRODUCTION_SUPPLIER", 1], ["PROJECT_COORDINATION", 1]]);
  assert.deepEqual(BALANCE.longProjects.anniversary3d.resourceRequirements.map((item) => [item.resourceType, item.quantity]), [["THREE_D_SLOT", 2], ["RECORDING_SLOT", 1], ["PROJECT_COORDINATION", 2]]);
});

test("new outfit requires three payment nodes, scheduled resources, work, wait, and quality before publication", () => {
  let state = game("outfit-lifecycle");
  state = unwrap(createLongProject(state, { templateId: "NEW_OUTFIT_STANDARD", date: "2026-09-14" }));
  const projectId = state.projects[0].id;
  assert.equal(state.cash.free, "600000");
  assert.equal(state.projects[0].status, "DRAFT");
  state = unwrap(submitLongProject(state, { projectId, date: "2026-09-14" }));
  assert.equal(state.projects[0].status, "APPROVED");
  state = unwrap(startLongProject(state, { projectId, date: "2026-09-14" }));
  assert.equal(state.cash.free, "555000");
  assert.equal(state.projects[0].spentCostJpy, "45000");
  assert.equal(state.projects[0].earliestPublishDate, "2026-10-12");
  assert.equal(state.resourceReservations.length, 1);
  assert.equal(state.resourceReservations[0].date, "2026-09-21");
  state = unwrap(enterLongProjectProduction(state, { projectId, date: "2026-09-14" }));
  assert.equal(state.cash.free, "495000");
  assert.equal(state.projects[0].spentCostJpy, "105000");
  assert.equal(processLongProjectDate(state, { projectId, date: "2026-10-12" }).code, "REQUIREMENT_UNMET");
  for (let index = 0; index < 4; index += 1) applyLongProjectWork(state, projectId, "2026-09-20");
  assert.equal(processLongProjectDate(state, { projectId, date: "2026-10-11" }).code, "TOO_EARLY");
  state = unwrap(processLongProjectDate(state, { projectId, date: "2026-10-12" }));
  assert.equal(state.projects[0].status, "QUALITY_CHECK");
  assert.equal(state.resourceReservations[0].status, "FULFILLED");
  state = unwrap(passLongProjectQuality(state, { projectId, date: "2026-10-12" }));
  assert.equal(state.cash.free, "450000");
  assert.deepEqual(state.projects[0].paymentPlan.paidNodes, ["startup", "production", "acceptance"]);
  state = unwrap(publishLongProject(state, { projectId, date: "2026-10-12" }));
  assert.equal(state.projects[0].status, "PUBLISHED");
  assert.equal(state.assets.length, 2);
  assert.equal(state.character.visualProductionBonus, 5);
  assert.equal(state.character.outfitRevealWindows, 1);
  assert.equal(state.projects[0].appliedEffect.globalSubscriberMultiplier, 1);
  for (const entry of state.history.journalEntries) {
    assert.equal(entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n), entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n), entry.id);
  }
});

test("A-22 restricted money cannot fund an unrelated new outfit", () => {
  let state = game("restricted-outfit");
  state = unwrap(createLongProject(state, { templateId: "NEW_OUTFIT_STANDARD", date: "2026-09-14" }));
  const projectId = state.projects[0].id;
  state = unwrap(submitLongProject(state, { projectId, date: "2026-09-14" }));
  state.cash.free = "0";
  state.cash.restricted = "500000";
  const result = startLongProject(state, { projectId, date: "2026-09-14" });
  assert.equal(result.code, "INSUFFICIENT_FREE_CASH");
  assert.equal(state.cash.restricted, "500000");
  assert.equal(state.projects[0].spentCostJpy, "0");
});

test("cancellation and pause preserve confirmed cost and the resumable stage", () => {
  let { state, projectId } = startProduction(game("cancel-outfit"), "NEW_OUTFIT_STANDARD");
  state = unwrap(pauseLongProject(state, { projectId, date: "2026-09-15" }));
  assert.equal(state.projects[0].status, "PAUSED");
  assert.equal(state.projects[0].pausedFromStatus, "PRODUCTION");
  state = unwrap(resumeLongProject(state, { projectId, date: "2026-09-16" }));
  assert.equal(state.projects[0].status, "PRODUCTION");
  state = unwrap(cancelLongProject(state, { projectId, date: "2026-09-17" }));
  assert.equal(state.projects[0].status, "CANCELLED");
  assert.equal(state.projects[0].cancellationTreatment.confirmedCostJpy, "105000");
  assert.equal(state.projects[0].cancellationTreatment.refundedJpy, "0");
  assert.equal(state.resourceReservations[0].status, "CANCELLED");
  assert.equal(state.cash.free, "495000");
});

test("company route uses review, fair manager allocation, contract snapshot, and company-owned asset permission", async () => {
  let state = game("company-outfit", "homolive");
  state = unwrap(createLongProject(state, { templateId: "NEW_OUTFIT_STANDARD", date: "2026-09-14" }));
  const projectId = state.projects[0].id;
  state = unwrap(submitLongProject(state, { projectId, date: "2026-09-14" }));
  assert.equal(state.projects[0].status, "REVIEW");
  state = unwrap(approveLongProject(state, { projectId, date: "2026-09-14" }));
  state = unwrap(startLongProject(state, { projectId, date: "2026-09-14" }));
  assert.equal(state.resourceReservations.length, 1);
  const managerRequirement = state.projects[0].pendingResourceRequirements.find((item) => item.resourceType === "MANAGER_ASSIST");
  state = unwrap(await requestAgencyResource(state, {
    projectId,
    resourceType: managerRequirement.resourceType,
    quantity: managerRequirement.quantity,
    desiredDate: managerRequirement.desiredDate,
    weekIndex: 1,
    date: "2026-09-14",
  }));
  state = unwrap(resolveAgencyResourceBatch(state, { roundId: state.resourceRequests[0].roundId, date: "2026-09-14" }));
  assert.equal(state.resourceReservations.length, 2);
  assert.equal(state.resourceReservations.some((item) => item.resourceType === "MANAGER_ASSIST" && item.providerParty === state.affiliation.agencyId), true);
  assert.equal(state.projects[0].contractSnapshot.id, state.contract.id);
  state = unwrap(enterLongProjectProduction(state, { projectId, date: "2026-09-14" }));
  state = finishProject(state, projectId, "2026-09-14");
  const asset = state.assets.at(-1);
  const license = state.licenses.find((item) => item.assetId === asset.id);
  assert.equal(asset.ownerParty, state.affiliation.agencyId);
  assert.equal(license.survivesTermination, false);
  assert.equal(state.projects[0].assetPermission.merchSaleLicenseGranted, false);
});

test("project work must bind to a real weekly slot and persists through week settlement", async () => {
  let { state, projectId } = startProduction(game("weekly-project-work"), "NEW_OUTFIT_STANDARD");
  const planned = updatePlan(state, 0, "PROJECT_WORK", { targetId: projectId, targetType: "LONG_TERM_PROJECT" });
  assert.equal(planned.ok, true);
  state = planned.state;
  const settled = await settleWeek(state);
  assert.equal(settled.ok, true);
  assert.equal(settled.state.projects[0].workCompleted, 1);
  assert.equal(settled.state.plan[0].targetType, "LONG_TERM_PROJECT");
});

test("music project publishes an independent asset and portfolio record without guaranteed profit", () => {
  let state = game("music-project");
  state.cash.free = "1000000";
  const started = startProduction(state, "ORIGINAL_SONG_STANDARD");
  state = finishProject(started.state, started.projectId, "2026-09-14");
  assert.equal(state.projects[0].status, "LONG_TAIL");
  assert.equal(state.projects[0].spentCostJpy, "350000");
  assert.equal(state.history.portfolioWorks.length, 1);
  assert.equal(state.history.portfolioWorks[0].kind, "MUSIC");
  assert.equal(state.projects[0].appliedEffect.guaranteedProfit, false);
  state = unwrap(archiveLongProject(state, { projectId: started.projectId, date: state.projects[0].longTailStartedAt }));
  assert.equal(state.projects[0].status, "ARCHIVED");
  assert.equal(state.assets.length, 2);
  assert.equal(state.history.portfolioWorks.length, 1);
});

test("visual asset bonus affects only visual production inputs, not every content type", async () => {
  let plainGame = game("visual-scope");
  let enhancedGame = game("visual-scope");
  enhancedGame.character.visualProductionBonus = 20;
  plainGame = updatePlan(plainGame, 0, "LIVE_GAME").state;
  enhancedGame = updatePlan(enhancedGame, 0, "LIVE_GAME").state;
  const plainNonVisual = await settleWeek(plainGame);
  const enhancedNonVisual = await settleWeek(enhancedGame);
  assert.equal(plainNonVisual.state.history.contents[0].quality, enhancedNonVisual.state.history.contents[0].quality);

  plainGame = game("visual-scope-video");
  enhancedGame = game("visual-scope-video");
  enhancedGame.character.visualProductionBonus = 20;
  plainGame = updatePlan(plainGame, 0, "MAKE_SHORT").state;
  enhancedGame = updatePlan(enhancedGame, 0, "MAKE_SHORT").state;
  const plainVisual = await settleWeek(plainGame);
  const enhancedVisual = await settleWeek(enhancedGame);
  assert.equal(enhancedVisual.state.history.contents[0].quality > plainVisual.state.history.contents[0].quality, true);
  assert.equal(enhancedVisual.state.history.contents[0].reasons.includes("视觉资产制作项 +20"), true);
});

test("A-27 repeated new outfits cap visual production bonus at 20 with no subscriber multiplier", () => {
  let state = game("repeated-outfits");
  state.cash.free = "1000000";
  const dates = ["2026-09-14", "2026-10-14", "2026-11-14", "2026-12-14", "2027-01-14"];
  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const started = startProduction(state, "NEW_OUTFIT_STANDARD", date);
    state = finishProject(started.state, started.projectId, date);
  }
  assert.equal(state.character.visualProductionBonus, 20);
  assert.equal(state.character.outfitRevealWindows, 5);
  assert.equal(state.channel.subscribers, 0);
  assert.equal("subscriberMultiplier" in state.character, false);
  assert.deepEqual(state.projects.map((project) => project.appliedEffect.visualProductionBonusAfter), [5, 10, 15, 20, 20]);
  assert.equal(state.projects.every((project) => project.appliedEffect.globalSubscriberMultiplier === 1), true);
});
