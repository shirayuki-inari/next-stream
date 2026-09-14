import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createGame, updatePlan } from "../src/domain/engine.js";
import { startWeekRun } from "../src/domain/week_run.js";
import { buildSavePackage, canonicalStringify, clearGame, loadBackups, loadMigratedGame, saveGame, sha256Hex, validateSavePackage } from "../src/storage.js";
import { RULESET_MANIFEST } from "../rules/ruleset_manifest.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };

function game(seed = "storage") {
  return createGame({ mode: "direct", routeId: "indie", performerCode: "SAVE", characterName: "存档测试", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed, abilities });
}

async function resign(payload) {
  payload.checksum.value = await sha256Hex(canonicalStringify(payload.game));
  return payload;
}

test("frozen ruleset manifest hashes match the shipped rule bytes", async () => {
  const fileHash = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
  assert.equal(await fileHash("rules/platform_youtube_reference_2026_09_12_v1.js"), RULESET_MANIFEST.platform.sha256);
  assert.equal(await fileHash("rules/balance_standard_0_1.js"), RULESET_MANIFEST.balance.sha256);
  const contentHash = createHash("sha256");
  for (const path of ["rules/actions.js", "rules/agency_profiles.js", "rules/distribution_services.js", "rules/event_templates.js", "rules/npc_profiles.js"]) contentHash.update(await readFile(path));
  assert.equal(contentHash.digest("hex"), RULESET_MANIFEST.content.sha256);
});

test("E-12 version 2 export round-trips an unfinished WeekRun checkpoint", async () => {
  const planned = updatePlan(game("checkpoint"), 0, "LIVE_GAME");
  const started = await startWeekRun(planned.state);
  assert.equal(started.ok, true);
  assert.equal(started.state.phase, "READY_TO_COMMIT");
  const payload = await buildSavePackage(started.state, "2026-09-14T00:00:00.000Z");
  assert.equal(payload.manifest.packageVersion, 2);
  assert.equal(payload.manifest.checkpoint.runId, started.state.weekRun.id);
  assert.match(payload.checksum.value, /^[a-f0-9]{64}$/);
  const restored = await validateSavePackage(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(restored.weekRun, started.state.weekRun);
  assert.equal(restored.phase, "READY_TO_COMMIT");
});

test("checksum detects a damaged world state before it can replace the save", async () => {
  const payload = await buildSavePackage(game("damaged"));
  payload.game.cash.free = "999999999";
  await assert.rejects(() => validateSavePackage(payload), /校验和不匹配/);
});

test("E-08 rejects prototype-pollution keys and unknown event instructions", async () => {
  const payload = await buildSavePackage(game("malicious"));
  const polluted = JSON.parse(JSON.stringify(payload).replace('"game":{', '"game":{"__proto__":{"polluted":true},'));
  await assert.rejects(() => validateSavePackage(polluted), /危险字段/);
  const unknownEvent = await buildSavePackage(game("unknown-event"));
  unknownEvent.game.textEvents.push({ id: "bad", templateId: "ARBITRARY_JAVASCRIPT", status: "PENDING", decisions: [] });
  await resign(unknownEvent);
  await assert.rejects(() => validateSavePackage(unknownEvent), /未知模板或效果指令/);
  const maliciousHtml = await buildSavePackage(game("malicious-html"));
  maliciousHtml.game.character.name = '<img src=x onerror="globalThis.polluted=true">';
  await resign(maliciousHtml);
  await assert.rejects(() => validateSavePackage(maliciousHtml), /危险 HTML/);
  assert.equal({}.polluted, undefined);
});

test("E-09 rejects unbalanced journals and negative budgets even with a recomputed checksum", async () => {
  const unbalanced = await buildSavePackage(game("unbalanced"));
  unbalanced.game.history.journalEntries[0].lines[0].debit = "600001";
  await resign(unbalanced);
  await assert.rejects(() => validateSavePackage(unbalanced), /财务分录不平/);

  const negative = await buildSavePackage(game("negative-budget"));
  negative.game.audienceBudgets.push({ id: "bad_budget", totalJpy: "100", allocatedJpy: "100", remainingJpy: "-1" });
  await resign(negative);
  await assert.rejects(() => validateSavePackage(negative), /预算为负或不是整数/);
});

test("E-10 unsupported frozen rulesets and missing references are rejected", async () => {
  const unsupported = await buildSavePackage(game("ruleset"));
  unsupported.game.rulesets.balance = "future_balance";
  await resign(unsupported);
  await assert.rejects(() => validateSavePackage(unsupported), /UNSUPPORTED_RULESET/);

  const dangling = await buildSavePackage(game("dangling"));
  dangling.game.history.receivables.push({ id: "dangling", originalTransactionId: "missing_transaction", type: "SC", amountJpy: "1", receivedJpy: "0", adjustedJpy: "0", status: "OPEN" });
  await resign(dangling);
  await assert.rejects(() => validateSavePackage(dangling), /不存在的原交易/);
});

test("E-03 a storage write failure leaves the official save unchanged", async () => {
  const original = game("storage-failure-original");
  const next = structuredClone(original);
  next.snapshotVersion += 1;
  const originalText = JSON.stringify(original);
  const values = new Map([["next-stream.save.v1", originalText]]);
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (key === "next-stream.save.v1") throw new Error("simulated quota failure");
      values.set(key, value);
    },
    removeItem(key) { values.delete(key); },
  };
  try {
    await assert.rejects(() => saveGame(next), /simulated quota failure/);
    assert.equal(values.get("next-stream.save.v1"), originalText);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test("E-11 a failed schema upgrade keeps the primary bytes and restores an intact backup without rewriting either", async () => {
  const primaryText = JSON.stringify(game("migration-primary"));
  const backupText = JSON.stringify(game("migration-backup"));
  const values = new Map([
    ["next-stream.save.v1", primaryText],
    ["next-stream.backups.v1", JSON.stringify([backupText])],
  ]);
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  try {
    const result = await loadMigratedGame((candidate) => {
      if (candidate.seed === "migration-primary") throw new Error("simulated migration failure");
      return structuredClone(candidate);
    });
    assert.equal(result.source, "backup-1");
    assert.equal(result.game.seed, "migration-backup");
    assert.match(result.error, /原文件与备份均未改写/);
    assert.equal(values.get("next-stream.save.v1"), primaryText);
    assert.equal(values.get("next-stream.backups.v1"), JSON.stringify([backupText]));
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test("large-save backup rotation occurs at checkpoint boundaries and clear removes all local snapshots", async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  try {
    const initial = game("backup-boundary");
    await saveGame(initial);
    const planEdit = structuredClone(initial);
    planEdit.snapshotVersion += 1;
    await saveGame(planEdit);
    assert.equal(loadBackups().length, 0);
    const report = structuredClone(planEdit);
    report.phase = "REPORT";
    report.snapshotVersion += 1;
    await saveGame(report);
    assert.equal(loadBackups().length, 1);
    await clearGame();
    assert.equal(values.has("next-stream.save.v1"), false);
    assert.equal(values.has("next-stream.backups.v1"), false);
    assert.equal(values.has("next-stream.save-meta.v1"), false);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
