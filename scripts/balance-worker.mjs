import { parentPort } from "node:worker_threads";
import { runTrajectory } from "./simulation.mjs";

parentPort.on("message", async (job) => {
  try {
    const result = await runTrajectory(job);
    parentPort.postMessage({ ok: true, jobId: job.jobId, result });
  } catch (error) {
    parentPort.postMessage({ ok: false, jobId: job.jobId, error: error instanceof Error ? error.stack || error.message : String(error) });
  }
});
