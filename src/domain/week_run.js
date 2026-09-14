import { settleWeek } from "./engine.js";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function startWeekRun(sourceState) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "只有计划阶段可以开始本周" };
  const planHash = await sha256Hex(sourceState.plan);
  const stagedResult = await settleWeek(sourceState);
  if (!stagedResult.ok) return stagedResult;
  const state = structuredClone(sourceState);
  state.snapshotVersion += 1;
  state.phase = "READY_TO_COMMIT";
  const stagedState = stagedResult.state;
  stagedState.weekRun = null;
  state.weekRun = {
    id: `week_run_${sourceState.id}_${sourceState.weekIndex}`,
    weekIndex: sourceState.weekIndex,
    baseSnapshotVersion: sourceState.snapshotVersion,
    planHash,
    runRevision: 1,
    cursor: 14,
    status: "READY_TO_COMMIT",
    stagedState,
    report: stagedResult.report,
  };
  return { ok: true, state, report: stagedResult.report };
}

export function continueWeekRun(sourceState) {
  if (sourceState.phase === "READY_TO_COMMIT" && sourceState.weekRun?.status === "READY_TO_COMMIT") return { ok: true, state: structuredClone(sourceState), report: sourceState.weekRun.report };
  return { ok: false, code: "INVALID_PHASE", message: "当前没有可继续的周运行" };
}

export function commitWeekRun(sourceState) {
  if (sourceState.phase !== "READY_TO_COMMIT" || sourceState.weekRun?.status !== "READY_TO_COMMIT" || !sourceState.weekRun.stagedState) return { ok: false, code: "INVALID_PHASE", message: "当前没有等待提交的周结算" };
  const run = sourceState.weekRun;
  const state = structuredClone(run.stagedState);
  state.snapshotVersion = sourceState.snapshotVersion + 1;
  state.phase = "REPORT";
  state.commandRecords = structuredClone(sourceState.commandRecords || []);
  state.weekRun = {
    id: run.id,
    weekIndex: run.weekIndex,
    baseSnapshotVersion: run.baseSnapshotVersion,
    planHash: run.planHash,
    runRevision: run.runRevision + 1,
    cursor: run.cursor,
    status: "COMMITTED",
  };
  return { ok: true, state, report: run.report };
}
