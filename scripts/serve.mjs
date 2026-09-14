import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = process.cwd();
const port = Number(process.env.NEXT_STREAM_PORT || 4173);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function safePath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const candidate = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
  return candidate;
}

const server = createServer(async (request, response) => {
  try {
    const filePath = safePath(request.url || "/");
    if (!filePath || request.method !== "GET") {
      response.writeHead(filePath ? 405 : 403).end();
      return;
    }
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("NOT_A_FILE");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`下一场直播开发服务器：http://127.0.0.1:${port}`);
});
