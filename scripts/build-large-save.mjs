import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSavePackage } from "../src/storage.js";
import { runTrajectory } from "./simulation.mjs";

const outputDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "output", "validation");
const trajectory = await runTrajectory({ routeId: "homolive", strategyId: "merch", seed: "large-save-browser", returnState: true });
const payload = await buildSavePackage(trajectory.state, "2026-09-14T00:00:00.000Z");
const serialized = JSON.stringify(payload);
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "d9-large-save.json");
await writeFile(outputPath, serialized, "utf8");
process.stdout.write(`${outputPath}\n${Buffer.byteLength(serialized, "utf8")} bytes\n`);
