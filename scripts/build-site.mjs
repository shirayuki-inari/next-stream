import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(workspaceDirectory, "dist");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await cp(path.join(workspaceDirectory, "index.html"), path.join(outputDirectory, "index.html"));
await cp(path.join(workspaceDirectory, "src"), path.join(outputDirectory, "src"), { recursive: true });
await cp(path.join(workspaceDirectory, "rules"), path.join(outputDirectory, "rules"), { recursive: true });
await writeFile(path.join(outputDirectory, ".nojekyll"), "", "utf8");

process.stdout.write("Built GitHub Pages artifact in dist/\n");
