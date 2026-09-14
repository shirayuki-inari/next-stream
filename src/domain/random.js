const encoder = new TextEncoder();
let nodeSha256 = null;

// Native Web Crypto keeps the browser bundle dependency-free. The validation
// runner uses Node's synchronous implementation to avoid one promise scheduling
// round-trip for every deterministic draw while producing identical bytes.
if (globalThis.process?.versions?.node) {
  const { createHash } = await import("node:crypto");
  nodeSha256 = (value) => createHash("sha256").update(value, "utf8").digest();
}

export async function deterministicRandom(seed, weekIndex, systemId, entityId, drawIndex) {
  const scope = [seed, weekIndex, systemId, entityId, drawIndex].join("/");
  const digest = nodeSha256 ? nodeSha256(scope) : await crypto.subtle.digest("SHA-256", encoder.encode(scope));
  const view = new DataView(digest.buffer, digest.byteOffset || 0, digest.byteLength);
  const value = view.getBigUint64(0, false) >> 11n;
  return Number(value) / 2 ** 53;
}
