import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../src/domain/engine.js";
import { changeContentVisibility } from "../src/domain/content.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

test("CHANGE_CONTENT_VISIBILITY recalculates eligibility while preserving history and earned finance", () => {
  const state = createGame({ mode: "direct", routeId: "indie", performerCode: "VIS", characterName: "公开状态", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed: "visibility", abilities });
  state.history.contents.push({ id: "content_visible", channelId: state.channel.id, type: "VIDEO", actionId: "EDIT_VIDEO", publishedAt: "2026-09-14", visibility: "PUBLIC", watchMinutes: 180000, uniqueEstimate: 1000, quality: 70 });
  state.finance.adsCreatorEarned = "1200";
  const hidden = changeContentVisibility(state, { contentId: "content_visible", visibility: "PRIVATE", date: "2026-09-15" });
  assert.equal(hidden.ok, true);
  assert.equal(hidden.state.history.contents.length, 1);
  assert.equal(hidden.content.visibility, "PRIVATE");
  assert.equal(hidden.state.channel.validWatchMinutes12m, 0);
  assert.equal(hidden.state.finance.adsCreatorEarned, "1200");
  const deleted = changeContentVisibility(hidden.state, { contentId: "content_visible", visibility: "DELETED", date: "2026-09-16" });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.content.deletedAt, "2026-09-16");
  assert.equal(deleted.state.history.contents.length, 1);
  assert.equal(deleted.content.visibilityHistory.length, 2);
});
