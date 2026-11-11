import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../src/domain/engine.js";
import { buildSavePackage, validateGameState, validateSavePackage } from "../src/storage.js";
import { SUPPORTED_RULESET_VERSIONS } from "../rules/ruleset_manifest.js";

const balanced = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };
const game = (seed, balanceRulesetId) => createGame({ mode: "direct", routeId: "indie", performerCode: "COMPAT", characterName: "兼容测试", primaryLanguage: "jp", primaryDirection: "game", careerGoal: "creator", seed, abilities: balanced, balanceRulesetId });

test("a started 0_1 save still validates and its export declares the 0_1 ruleset hash", async () => {
  const legacy = game("compat-legacy", "balance_standard_0_1");
  assert.doesNotThrow(() => validateGameState(legacy));
  const payload = await buildSavePackage(legacy, "2026-09-14T00:00:00.000Z");
  assert.equal(payload.manifest.rulesets.balance.id, "balance_standard_0_1");
  assert.equal(payload.manifest.rulesets.balance.sha256, SUPPORTED_RULESET_VERSIONS.balance.balance_standard_0_1);
  const restored = await validateSavePackage(JSON.parse(JSON.stringify(payload)));
  assert.equal(restored.rulesets.balance, "balance_standard_0_1");
});

test("an export cannot relabel a save to a different balance ruleset", async () => {
  const legacy = game("compat-relabel", "balance_standard_0_1");
  const payload = await buildSavePackage(legacy, "2026-09-14T00:00:00.000Z");
  const current = await buildSavePackage(game("compat-current"), "2026-09-14T00:00:00.000Z");
  payload.manifest.rulesets.balance = current.manifest.rulesets.balance;
  await assert.rejects(validateSavePackage(JSON.parse(JSON.stringify(payload))), /UNSUPPORTED_RULESET/);
});

test("an unknown balance ruleset id is rejected", () => {
  const unknown = game("compat-unknown");
  unknown.rulesets.balance = "balance_standard_9_9";
  assert.throws(() => validateGameState(unknown), /UNSUPPORTED_RULESET/);
});
