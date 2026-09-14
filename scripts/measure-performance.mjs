import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTrajectory } from "./simulation.mjs";

const outputDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "output", "validation");
const scenarios = [
  ["indie", "conservative", "perf-indie"],
  ["homolive", "merch", "perf-homolive"],
  ["niji2434", "trend", "perf-niji"],
];

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const samples = [];
for (const [routeId, strategyId, seed] of scenarios) {
  const result = await runTrajectory({ routeId, strategyId, seed });
  samples.push({ routeId, strategyId, saveBytes: result.saveBytes, totalDurationMs: result.durationMs, settlementDurationsMs: result.settlementDurationsMs });
  process.stdout.write(`${routeId}/${strategyId}: ${(result.saveBytes / 1024 / 1024).toFixed(2)} MB, week P95 ${percentile(result.settlementDurationsMs, 0.95).toFixed(2)} ms\n`);
}
const allWeeks = samples.flatMap((item) => item.settlementDurationsMs);
const report = {
  generatedAt: new Date().toISOString(),
  environment: { runtime: process.version, platform: `${process.platform}-${process.arch}`, logicalProcessors: (await import("node:os")).availableParallelism() },
  scope: "3 representative 104-week trajectories; pure domain settlement timing, no rendering or network",
  results: {
    weekSettlementMs: { p50: percentile(allWeeks, 0.5), p95: percentile(allWeeks, 0.95), max: Math.max(...allWeeks) },
    saveBytes: { max: Math.max(...samples.map((item) => item.saveBytes)), target: 25 * 1024 * 1024 },
    pass: percentile(allWeeks, 0.95) < 2000 && Math.max(...samples.map((item) => item.saveBytes)) <= 25 * 1024 * 1024,
  },
  samples,
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "d9-performance-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`aggregate: P95 ${report.results.weekSettlementMs.p95.toFixed(2)} ms, max save ${(report.results.saveBytes.max / 1024 / 1024).toFixed(2)} MB, pass=${report.results.pass}\n`);
