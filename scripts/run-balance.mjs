import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { deterministicSeed, ROUTE_IDS, STRATEGY_IDS, STRATEGY_LABELS } from "./simulation.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(workspaceDirectory, "output", "validation");

function option(name, fallback) {
  const prefixed = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefixed));
  return value ? value.slice(prefixed.length) : fallback;
}

const seedCount = Number(option("seeds", "100"));
const requestedWorkers = Number(option("workers", String(Math.min(8, os.availableParallelism?.() || os.cpus().length || 4))));
if (!Number.isInteger(seedCount) || seedCount < 1) throw new Error("--seeds must be a positive integer");
if (!Number.isInteger(requestedWorkers) || requestedWorkers < 1) throw new Error("--workers must be a positive integer");

const jobs = [];
for (let seedIndex = 1; seedIndex <= seedCount; seedIndex += 1) {
  for (const routeId of ROUTE_IDS) {
    for (const strategyId of STRATEGY_IDS) {
      jobs.push({ jobId: jobs.length + 1, routeId, strategyId, seed: deterministicSeed(seedIndex), weeks: 104, validateEveryWeek: false });
    }
  }
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function stats(values) {
  return {
    p05: Math.round(percentile(values, 0.05) * 100) / 100,
    median: Math.round(percentile(values, 0.5) * 100) / 100,
    p95: Math.round(percentile(values, 0.95) * 100) / 100,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function summarizeGroup(values) {
  const checkpoints = {};
  for (const week of [26, 52, 104]) {
    const atWeek = values.map((item) => item.checkpoints[week]);
    checkpoints[week] = {
      subscribers: stats(atWeek.map((item) => item.subscribers)),
      active: stats(atWeek.map((item) => item.active)),
      cashFreeJpy: stats(atWeek.map((item) => Number(item.cashFreeJpy))),
      receivableJpy: stats(atWeek.map((item) => Number(item.receivableJpy))),
      fatigue: stats(atWeek.map((item) => item.fatigue)),
      stress: stats(atWeek.map((item) => item.stress)),
      projectDefaults: stats(atWeek.map((item) => item.projectDefaults)),
      careerChanges: stats(atWeek.map((item) => item.careerChanges)),
    };
  }
  return {
    samples: values.length,
    sustainableRate: values.filter((item) => item.sustainable).length / values.length,
    zeroCashTrajectoryRate: values.filter((item) => item.zeroCashWeeks > 0).length / values.length,
    saveBytes: stats(values.map((item) => item.saveBytes)),
    durationMs: stats(values.map((item) => item.durationMs)),
    settledProjects: stats(values.map((item) => item.settledProjectCount)),
    projectProfitJpy: stats(values.map((item) => Number(item.projectProfitJpy))),
    royaltyCreatorEarnedJpy: stats(values.map((item) => Number(item.royaltyCreatorEarnedJpy))),
    objectiveScores: Object.fromEntries(Object.keys(values[0].objectiveScores).map((key) => [key, stats(values.map((item) => item.objectiveScores[key]))])),
    checkpoints,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function reportMarkdown(report) {
  const lines = [
    "# D9 平衡与长期回放报告",
    "",
    `生成时间：${report.generatedAt}`,
    "",
    `样本：${report.method.seedCount} 个确定性种子 × 3 条路线 × 4 种策略 = ${report.method.trajectoryCount} 条 104 周轨迹。`,
    "",
    "## 判定结果",
    "",
    ...Object.entries(report.criteria).map(([key, item]) => `- ${item.pass ? "通过" : "未通过"} · ${key}：${item.note}`),
    "",
    "## 第 104 周中位数",
    "",
    "| 路线 | 策略 | 可持续率 | 订阅 | 28日活跃 | 自由现金 | 应收 | 疲劳 | 存档 P95 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const routeId of ROUTE_IDS) {
    for (const strategyId of STRATEGY_IDS) {
      const item = report.groups[`${routeId}/${strategyId}`];
      const week = item.checkpoints[104];
      lines.push(`| ${routeId} | ${STRATEGY_LABELS[strategyId]} | ${(item.sustainableRate * 100).toFixed(0)}% | ${formatNumber(week.subscribers.median)} | ${formatNumber(week.active.median)} | ¥${formatNumber(week.cashFreeJpy.median)} | ¥${formatNumber(week.receivableJpy.median)} | ${formatNumber(week.fatigue.median)} | ${(item.saveBytes.p95 / 1024 / 1024).toFixed(2)} MB |`);
    }
  }
  lines.push(
    "",
    "## 口径与限制",
    "",
    "- 可持续：第 104 周自由现金大于 0、疲劳和压力均低于 80、身体状态至少 30、无项目违约、会员承诺履行率至少 80%。",
    "- 每组用同一组种子和完全相同的初始能力；仅策略排期不同，便于配对比较。",
    "- 订阅、活跃与收入是内部模型结果，不用于预测现实平台或现实职业结果。",
    "- 本报告验证首版参数的可玩区间，不把冻结参数宣称为已完成商业平衡；异常分布需继续记录并复测。",
    ""
  );
  return `${lines.join("\n")}\n`;
}

async function runJobs() {
  const results = [];
  const failures = [];
  let nextIndex = 0;
  let completed = 0;
  const startedAt = Date.now();
  const workerCount = Math.min(requestedWorkers, jobs.length);
  process.stdout.write(`D9 batch: ${jobs.length} trajectories, ${workerCount} workers\n`);

  await new Promise((resolve, reject) => {
    const workers = [];
    let stopping = false;
    const dispatch = (worker) => {
      if (nextIndex >= jobs.length) {
        if (completed === jobs.length && !stopping) {
          stopping = true;
          Promise.all(workers.map((item) => item.terminate())).then(resolve, reject);
        }
        return;
      }
      worker.postMessage(jobs[nextIndex++]);
    };
    for (let index = 0; index < workerCount; index += 1) {
      const worker = new Worker(new URL("./balance-worker.mjs", import.meta.url));
      workers.push(worker);
      worker.on("message", (message) => {
        completed += 1;
        if (message.ok) results.push(message.result);
        else failures.push({ jobId: message.jobId, error: message.error });
        if (completed % Math.max(1, Math.floor(jobs.length / 100)) === 0 || completed === jobs.length) {
          const elapsedMinutes = (Date.now() - startedAt) / 60_000;
          const rate = completed / Math.max(elapsedMinutes, 1 / 60);
          const eta = (jobs.length - completed) / Math.max(rate, 0.001);
          process.stdout.write(`progress ${completed}/${jobs.length} (${(completed / jobs.length * 100).toFixed(1)}%), ETA ${eta.toFixed(1)} min\n`);
        }
        dispatch(worker);
      });
      worker.on("error", reject);
      dispatch(worker);
    }
  });
  return { results, failures, elapsedMs: Date.now() - startedAt };
}

const batch = await runJobs();
const groups = {};
for (const routeId of ROUTE_IDS) {
  for (const strategyId of STRATEGY_IDS) {
    const values = batch.results.filter((item) => item.routeId === routeId && item.strategyId === strategyId);
    if (values.length) groups[`${routeId}/${strategyId}`] = summarizeGroup(values);
  }
}

const sustainableRoutes = Object.fromEntries(ROUTE_IDS.map((routeId) => {
  const candidates = STRATEGY_IDS.map((strategyId) => ({ strategyId, rate: groups[`${routeId}/${strategyId}`]?.sustainableRate || 0 }));
  return [routeId, candidates.sort((a, b) => b.rate - a.rate)[0]];
}));
const objectiveWinners = {};
for (const objective of ["livelihood", "creator", "stage", "community", "brand", "reach"]) {
  objectiveWinners[objective] = STRATEGY_IDS.map((strategyId) => ({
    strategyId,
    score: percentile(ROUTE_IDS.map((routeId) => groups[`${routeId}/${strategyId}`].objectiveScores[objective].median), 0.5),
  })).sort((a, b) => b.score - a.score)[0];
}
const winnerStrategies = new Set(Object.values(objectiveWinners).map((item) => item.strategyId));
const maxSaveBytes = Math.max(...batch.results.map((item) => item.saveBytes));
const companyRouteIds = ["homolive", "niji2434"];
const companyMerchProfitVaries = companyRouteIds.every((routeId) => {
  const royalty = groups[`${routeId}/merch`].royaltyCreatorEarnedJpy;
  return royalty.min < royalty.max;
});
const companyMerchHasTradeoff = companyRouteIds.every((routeId) => {
  const merchandise = groups[`${routeId}/merch`].objectiveScores;
  return Object.keys(merchandise).some((objective) =>
    STRATEGY_IDS.some((strategyId) => groups[`${routeId}/${strategyId}`].objectiveScores[objective].median > merchandise[objective].median));
});
const companyHasUnsustainablePolicy = companyRouteIds.every((routeId) =>
  STRATEGY_IDS.some((strategyId) => groups[`${routeId}/${strategyId}`].sustainableRate < 0.8));
const report = {
  generatedAt: new Date().toISOString(),
  method: { seedCount, routeCount: ROUTE_IDS.length, strategyCount: STRATEGY_IDS.length, trajectoryCount: jobs.length, completed: batch.results.length, failures: batch.failures.length, workers: Math.min(requestedWorkers, jobs.length), elapsedMs: batch.elapsedMs },
  criteria: {
    trajectoryIntegrity: { pass: batch.failures.length === 0 && batch.results.length === jobs.length, note: `${batch.results.length}/${jobs.length} 条完成；${batch.failures.length} 条失败` },
    sustainableRoute: { pass: Object.values(sustainableRoutes).every((item) => item.rate >= 0.8), note: Object.entries(sustainableRoutes).map(([route, item]) => `${route}=${STRATEGY_LABELS[item.strategyId]} ${(item.rate * 100).toFixed(0)}%`).join("；") },
    noUniversalStrategyDominance: { pass: winnerStrategies.size > 1, note: `${winnerStrategies.size} 种策略分别赢得六类职业目标；${Object.entries(objectiveWinners).map(([goal, item]) => `${goal}:${STRATEGY_LABELS[item.strategyId]}`).join("，")}` },
    indieRepairPath: { pass: groups["indie/conservative"].sustainableRate >= 0.8 && groups["indie/conservative"].checkpoints[104].cashFreeJpy.p05 > 0, note: `保守经营可持续率 ${(groups["indie/conservative"].sustainableRate * 100).toFixed(0)}%，第104周现金P05 ¥${formatNumber(groups["indie/conservative"].checkpoints[104].cashFreeJpy.p05)}` },
    companyNotAutomaticSuccess: {
      pass: companyHasUnsustainablePolicy && companyMerchProfitVaries && companyMerchHasTradeoff,
      note: `公司路线存在不可持续排期=${companyHasUnsustainablePolicy ? "是" : "否"}；公司商品版税跨种子变化=${companyMerchProfitVaries ? "是" : "否"}；商品经营未支配全部职业目标=${companyMerchHasTradeoff ? "是" : "否"}。公司商品另需两个真实设计格，销售使用一次性候选池和共享消费预算`,
    },
    saveSizeTarget: { pass: maxSaveBytes <= 25 * 1024 * 1024, note: `104周最大存档 ${(maxSaveBytes / 1024 / 1024).toFixed(2)} MB（目标≤25MB）` },
  },
  sustainableRoutes,
  objectiveWinners,
  groups,
  failures: batch.failures,
  samples: batch.results,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "d9-balance-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDirectory, "d9-balance-report.md"), reportMarkdown(report), "utf8");
process.stdout.write(`wrote output/validation/d9-balance-report.json and .md in ${(batch.elapsedMs / 60_000).toFixed(1)} min\n`);
if (batch.failures.length) process.exitCode = 1;
