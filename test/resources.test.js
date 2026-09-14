import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../src/domain/engine.js";
import { approveLongProject, createLongProject, enterLongProjectProduction, startLongProject, submitLongProject } from "../src/domain/projects.js";
import { requestAgencyResource, resolveAgencyResourceBatch } from "../src/domain/resources.js";

const balanced = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game(seed, routeId) {
  return createGame({ mode: "direct", routeId, performerCode: "RESOURCE", characterName: "资源测试", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed, abilities: balanced });
}

function unwrap(result) {
  assert.equal(result.ok, true, result.message);
  return result.state;
}

function approvedProject(state, templateId) {
  state = unwrap(createLongProject(state, { templateId, date: "2026-09-14" }));
  const projectId = state.projects[0].id;
  state = unwrap(submitLongProject(state, { projectId, date: "2026-09-14" }));
  state = unwrap(approveLongProject(state, { projectId, date: "2026-09-14" }));
  state = unwrap(startLongProject(state, { projectId, date: "2026-09-14" }));
  return { state, projectId };
}

test("company project shared resources use one fair batch and create one dated reservation", async () => {
  let { state, projectId } = approvedProject(game("resource-approved", "homolive"), "NEW_OUTFIT_STANDARD");
  const project = state.projects[0];
  assert.equal(project.pendingResourceRequirements.length, 1);
  assert.equal(project.pendingResourceRequirements[0].resourceType, "MANAGER_ASSIST");
  assert.equal(state.resourceReservations.length, 1);
  const desiredDate = project.pendingResourceRequirements[0].desiredDate;
  state = unwrap(await requestAgencyResource(state, { projectId, resourceType: "MANAGER_ASSIST", quantity: 1, desiredDate, weekIndex: 1, date: "2026-09-14" }));
  const roundId = state.resourceRequests[0].roundId;
  state = unwrap(resolveAgencyResourceBatch(state, { roundId, date: "2026-09-14" }));
  assert.equal(state.resourceRequests[0].status, "APPROVED");
  assert.equal(state.resourceReservations.length, 2);
  assert.equal(state.resourceReservations[1].date, desiredDate);
  const duplicateResolve = resolveAgencyResourceBatch(state, { roundId, date: "2026-09-14" });
  assert.equal(duplicateResolve.ok, false);
  assert.equal(state.resourceReservations.length, 2);
  state = unwrap(enterLongProjectProduction(state, { projectId, date: "2026-09-14" }));
  assert.equal(state.projects[0].status, "PRODUCTION");
});

test("A-30 insufficient company capacity yields an explained downscale without duplicate allocation", async () => {
  let { state, projectId } = approvedProject(game("resource-shortage", "niji2434"), "ANNIVERSARY_3D_STANDARD");
  const requirement = state.projects[0].pendingResourceRequirements.find((item) => item.resourceType === "THREE_D_SLOT");
  state = unwrap(await requestAgencyResource(state, { projectId, resourceType: "THREE_D_SLOT", quantity: 2, desiredDate: requirement.desiredDate, weekIndex: 1, date: "2026-09-14" }));
  const round = state.agencyResourceRounds[0];
  round.capacity = 1;
  state.resourceRequests[0].score.total = 100;
  state = unwrap(resolveAgencyResourceBatch(state, { roundId: round.id, date: "2026-09-14" }));
  const request = state.resourceRequests[0];
  assert.equal(request.status, "DOWNSCALED");
  assert.equal(request.allocatedQuantity, 1);
  assert.match(request.resultExplanation, /容量不足|仅可提供/);
  assert.equal(state.resourceReservations.filter((item) => item.requestId === request.id).length, 1);
  assert.equal(enterLongProjectProduction(state, { projectId, date: "2026-09-14" }).code, "RESOURCE_UNAVAILABLE");
  const duplicate = await requestAgencyResource(state, { projectId, resourceType: "THREE_D_SLOT", quantity: 2, desiredDate: requirement.desiredDate, weekIndex: 1, date: "2026-09-14" });
  assert.equal(duplicate.code, "RESOURCE_ALREADY_REQUESTED");
  assert.equal(state.resourceReservations.filter((item) => item.requestId === request.id).length, 1);
});
