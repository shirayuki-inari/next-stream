import { ACTIONS } from "../rules/actions.js";
import { RULESET_IDS } from "../rules/balance_standard_0_1.js";
import { EVENT_TEMPLATE_BY_ID } from "../rules/event_templates.js";
import { RULESET_MANIFEST } from "../rules/ruleset_manifest.js";

const STORAGE_KEY = "next-stream.save.v1";
const BACKUP_KEY = "next-stream.backups.v1";
const META_KEY = "next-stream.save-meta.v1";
const DATABASE_NAME = "next-stream.local-save";
const DATABASE_STORE = "records";
const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_ARRAY_LENGTHS = Object.freeze({ npcs: 20, audienceSegments: 24, plan: 14, worldWeeks: 1000, contents: 10000, weeklyReports: 1000, platformTransactions: 50000, journalEntries: 100000, commandRecords: 100000 });

export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertSafeShape(value, path = "game", seen = new Set()) {
  if (typeof value === "string" && /<\s*script|javascript\s*:|<[^>]+\son[a-z]+\s*=/i.test(value)) throw new Error(`存档包含危险 HTML：${path}`);
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("存档包含循环引用");
  seen.add(value);
  if (Array.isArray(value)) {
    const field = path.split(".").at(-1);
    const maximum = MAX_ARRAY_LENGTHS[field] ?? 100000;
    if (value.length > maximum) throw new Error(`存档数组过大：${path}`);
    value.forEach((item, index) => assertSafeShape(item, `${path}.${index}`, seen));
  } else {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`存档包含危险字段：${key}`);
      assertSafeShape(value[key], `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function isNonNegativeInteger(value) {
  return /^\d+$/.test(String(value));
}

function requireMoneyMap(value, label) {
  if (!value || typeof value !== "object" || Object.values(value).some((item) => !isNonNegativeInteger(item))) throw new Error(`${label}包含非法或负数金额`);
}

function assertReferencesAndRules(game) {
  if (!game.rulesets || Object.entries(RULESET_IDS).some(([key, id]) => game.rulesets[key] !== id)) throw new Error("UNSUPPORTED_RULESET：存档绑定的冻结规则包不可用");
  if (!Array.isArray(game.plan) || game.plan.length !== 14 || game.plan.some((slot, index) => slot.index !== index || (slot.actionId && !ACTIONS[slot.actionId]))) throw new Error("存档排期包含非法格号或活动 ID");
  if (!Array.isArray(game.audienceSegments) || game.audienceSegments.length !== 24) throw new Error("观众分群数据不完整");
  if (!Array.isArray(game.npcs) || game.npcs.length !== 20) throw new Error("主要 NPC 数据不完整");
  const contents = game.history?.contents || [];
  const contentIds = new Set(contents.map((item) => item.id));
  if (contentIds.size !== contents.length || contents.some((item) => !item.id || !ACTIONS[item.actionId])) throw new Error("内容记录包含重复 ID 或未知活动引用");
  if ((game.textEvents || []).some((event) => !EVENT_TEMPLATE_BY_ID[event.templateId])) throw new Error("事件记录包含未知模板或效果指令");
  const projectIds = new Set((game.projects || []).map((item) => item.id));
  if ((game.resourceReservations || []).some((item) => item.projectId && !projectIds.has(item.projectId))) throw new Error("资源预约引用了不存在的项目");
  const knownTransactionIds = new Set([...(game.history?.platformTransactions || []).map((item) => item.id), ...(game.sponsorships || []).map((item) => item.id), ...(game.history?.royaltyTransactions || []).map((item) => item.id)]);
  if ((game.history?.receivables || []).some((item) => item.originalTransactionId && !knownTransactionIds.has(item.originalTransactionId))) throw new Error("应收款引用了不存在的原交易");
}

function assertFinancialIntegrity(game) {
  requireMoneyMap(game.cash, "现金账户");
  requireMoneyMap(game.liabilities, "负债账户");
  requireMoneyMap(game.finance, "财务累计");
  for (const budget of game.audienceBudgets || []) {
    for (const key of ["totalJpy", "allocatedJpy", "remainingJpy"]) if (budget[key] != null && !isNonNegativeInteger(budget[key])) throw new Error("观众消费预算为负或不是整数");
    if (BigInt(budget.remainingJpy || 0) > BigInt(budget.totalJpy || budget.allocatedJpy || 0)) throw new Error("观众消费预算余额超过周期总额");
  }
  for (const entry of game.history?.journalEntries || []) {
    if (!Array.isArray(entry.lines) || !entry.lines.length) throw new Error("财务分录缺少借贷行");
    let debit = 0n;
    let credit = 0n;
    for (const line of entry.lines) {
      if (!isNonNegativeInteger(line.debit) || !isNonNegativeInteger(line.credit)) throw new Error("财务分录包含非法或负数金额");
      debit += BigInt(line.debit);
      credit += BigInt(line.credit);
    }
    if (debit !== credit) throw new Error(`财务分录不平：${entry.id || "未知分录"}`);
  }
}

export function validateGameState(game) {
  assertSafeShape(game);
  if (!game || game.schemaVersion !== 1 || typeof game.id !== "string" || !game.id || !Number.isInteger(game.snapshotVersion) || game.snapshotVersion < 1) throw new Error("存档结构或版本不受支持");
  assertReferencesAndRules(game);
  assertFinancialIntegrity(game);
  return true;
}

export async function buildSavePackage(state, exportedAt = new Date().toISOString()) {
  validateGameState(state);
  const game = structuredClone(state);
  const checksum = await sha256Hex(canonicalStringify(game));
  return {
    manifest: {
      format: "next-stream-save",
      packageVersion: 2,
      schemaVersion: game.schemaVersion,
      exportedAt,
      contentVersion: game.rulesets.content,
      rulesets: structuredClone(RULESET_MANIFEST),
      checkpoint: ["RUNNING", "AWAITING_CHOICE", "READY_TO_COMMIT"].includes(game.phase) && game.weekRun ? { runId: game.weekRun.id, runRevision: game.weekRun.runRevision, phase: game.phase } : null,
    },
    checksum: { algorithm: "SHA-256", scope: "canonical-game", value: checksum },
    game,
  };
}

export async function validateSavePackage(parsed) {
  assertSafeShape(parsed, "package");
  if (parsed?.manifest?.format !== "next-stream-save" || !parsed.game) throw new Error("不是有效的《下一场直播》存档");
  if (parsed.manifest.packageVersion != null && parsed.manifest.packageVersion !== 2) throw new Error("存档包版本不受支持");
  validateGameState(parsed.game);
  if (parsed.manifest.schemaVersion !== parsed.game.schemaVersion) throw new Error("清单与世界状态版本不一致");
  if (parsed.manifest.packageVersion === 2) {
    for (const key of Object.keys(RULESET_MANIFEST)) {
      const declared = parsed.manifest.rulesets?.[key];
      const expected = RULESET_MANIFEST[key];
      if (declared?.id !== expected.id || declared?.sha256 !== expected.sha256) throw new Error(`UNSUPPORTED_RULESET：${key} 规则哈希不匹配`);
    }
    if (parsed.checksum?.algorithm !== "SHA-256" || parsed.checksum?.scope !== "canonical-game" || !/^[a-f0-9]{64}$/.test(parsed.checksum?.value || "")) throw new Error("存档缺少有效校验和");
    const actual = await sha256Hex(canonicalStringify(parsed.game));
    if (actual !== parsed.checksum.value) throw new Error("存档校验和不匹配，文件可能损坏");
  }
  return structuredClone(parsed.game);
}

let cachedBackups = [];
let cachedMetadata = null;
let saveQueue = Promise.resolve();

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DATABASE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 打开失败"));
  });
}

async function readIndexedRecords() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, "readonly");
    const store = transaction.objectStore(DATABASE_STORE);
    const primary = store.get(STORAGE_KEY);
    const backups = store.get(BACKUP_KEY);
    const metadata = store.get(META_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve({ primary: primary.result || null, backups: Array.isArray(backups.result) ? backups.result : [], metadata: metadata.result || null });
    };
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error("IndexedDB 读取失败")); };
    transaction.onabort = transaction.onerror;
  });
}

async function writeIndexedRecords({ primary, backups, metadata }) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, "readwrite");
    const store = transaction.objectStore(DATABASE_STORE);
    store.put(primary, STORAGE_KEY);
    store.put(backups, BACKUP_KEY);
    store.put(metadata, META_KEY);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error("IndexedDB 写入失败")); };
    transaction.onabort = transaction.onerror;
  });
}

async function writeIndexedSave(serialized, metadata) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, "readwrite");
    const store = transaction.objectStore(DATABASE_STORE);
    const primaryRequest = store.get(STORAGE_KEY);
    const backupsRequest = store.get(BACKUP_KEY);
    const metadataRequest = store.get(META_KEY);
    let ready = 0;
    const stageWrites = () => {
      ready += 1;
      if (ready !== 3) return;
      const current = primaryRequest.result || null;
      const backups = Array.isArray(backupsRequest.result) ? backupsRequest.result : [];
      const previousMetadata = metadataRequest.result || null;
      const checkpointBoundary = previousMetadata?.weekIndex !== metadata.weekIndex
        || previousMetadata?.phase !== metadata.phase
        || ["REPORT", "READY_TO_COMMIT"].includes(metadata.phase);
      const nextBackups = current && current !== serialized && checkpointBoundary ? [current, ...backups].slice(0, 3) : backups;
      store.put(serialized, STORAGE_KEY);
      store.put(nextBackups, BACKUP_KEY);
      store.put(metadata, META_KEY);
      cachedBackups = nextBackups;
    };
    primaryRequest.onsuccess = stageWrites;
    backupsRequest.onsuccess = stageWrites;
    metadataRequest.onsuccess = stageWrites;
    transaction.oncomplete = () => { database.close(); cachedMetadata = metadata; resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error("IndexedDB 原子写入失败")); };
    transaction.onabort = transaction.onerror;
  });
}

function legacyBackups() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function loadMigratedGame(migrate) {
  let primaryRaw = null;
  let backups = [];
  let metadata = null;
  let backend = "legacy";
  try {
    if (hasIndexedDb()) {
      const indexed = await readIndexedRecords();
      primaryRaw = indexed.primary;
      backups = indexed.backups;
      metadata = indexed.metadata;
      backend = "indexeddb";
    }
    if (!primaryRaw) {
      primaryRaw = localStorage.getItem(STORAGE_KEY);
      backups = legacyBackups();
      try { metadata = JSON.parse(localStorage.getItem(META_KEY) || "null"); } catch { metadata = null; }
      backend = "legacy";
    }
  } catch (error) {
    return { game: null, source: "none", error: `无法读取本地主存档：${error.message}` };
  }
  if (!primaryRaw) return { game: null, source: "none", error: null };
  cachedBackups = backups;
  cachedMetadata = metadata;
  const candidates = [{ source: "primary", raw: primaryRaw }, ...backups.map((raw, index) => ({ source: `backup-${index + 1}`, raw }))];
  const errors = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.raw);
      const migrated = migrate(parsed);
      validateGameState(migrated);
      if (candidate.source === "primary" && backend === "legacy" && hasIndexedDb()) {
        await writeIndexedRecords({ primary: primaryRaw, backups, metadata: metadata || { savedAt: null, snapshotVersion: migrated.snapshotVersion } });
        cachedMetadata = metadata || { savedAt: null, snapshotVersion: migrated.snapshotVersion };
      }
      return {
        game: migrated,
        source: candidate.source,
        error: candidate.source === "primary" ? (backend === "legacy" && hasIndexedDb() ? "旧版浏览器存档已迁移到大容量本地存储；世界状态未改变。" : null) : `主存档升级失败，已只读恢复本地备份 ${candidate.source.slice(7)}；原文件与备份均未改写。`,
      };
    } catch (error) {
      errors.push(`${candidate.source}: ${error.message}`);
    }
  }
  return { game: null, source: "none", error: `存档升级失败；原主存档与备份均保持不变。${errors[0] || ""}` };
}

export function saveGame(state) {
  validateGameState(state);
  const serialized = JSON.stringify(state);
  const metadata = { savedAt: new Date().toISOString(), snapshotVersion: state.snapshotVersion, weekIndex: state.weekIndex, phase: state.phase };
  const operation = saveQueue.then(async () => {
    if (hasIndexedDb()) return writeIndexedSave(serialized, metadata);
    const current = localStorage.getItem(STORAGE_KEY);
    let previousMetadata = null;
    try { previousMetadata = JSON.parse(localStorage.getItem(META_KEY) || "null"); } catch { previousMetadata = null; }
    const checkpointBoundary = previousMetadata?.weekIndex !== metadata.weekIndex || previousMetadata?.phase !== metadata.phase || ["REPORT", "READY_TO_COMMIT"].includes(metadata.phase);
    if (current && current !== serialized && checkpointBoundary) {
      const backups = legacyBackups();
      backups.unshift(current);
      localStorage.setItem(BACKUP_KEY, JSON.stringify(backups.slice(0, 3)));
      cachedBackups = backups.slice(0, 3);
    }
    localStorage.setItem(STORAGE_KEY, serialized);
    try { localStorage.setItem(META_KEY, JSON.stringify(metadata)); } catch { /* UI-only metadata must not invalidate the world-state write. */ }
    cachedMetadata = metadata;
  });
  saveQueue = operation.catch(() => {});
  return operation;
}

export function loadSaveMetadata() {
  if (hasIndexedDb()) return cachedMetadata;
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadBackups() {
  if (hasIndexedDb()) return [...cachedBackups];
  return legacyBackups();
}

export async function clearGame() {
  await saveQueue.catch(() => {});
  if (hasIndexedDb()) {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(DATABASE_STORE, "readwrite");
      const store = transaction.objectStore(DATABASE_STORE);
      store.delete(STORAGE_KEY);
      store.delete(BACKUP_KEY);
      store.delete(META_KEY);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error || new Error("本地存档删除失败")); };
      transaction.onabort = transaction.onerror;
    });
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BACKUP_KEY);
    localStorage.removeItem(META_KEY);
  } catch { /* IndexedDB remains the primary store. */ }
  cachedBackups = [];
  cachedMetadata = null;
}

export async function exportGame(state) {
  const payload = await buildSavePackage(state);
  // Compact JSON keeps a late-career READY_TO_COMMIT package (which includes its
  // resumable staged state) below the same 32 MB ceiling enforced on import.
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `next-stream-week-${state.weekIndex}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  return payload;
}

export async function importGame(file) {
  if (!file || file.size > MAX_IMPORT_BYTES) throw new Error("存档文件必须小于 32MB");
  const text = await file.text();
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error("存档文件必须小于 32MB");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("存档不是有效的 UTF-8 JSON"); }
  return validateSavePackage(parsed);
}
