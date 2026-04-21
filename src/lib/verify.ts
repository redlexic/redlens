// sha256 verification for shipped JSON artifacts.
//
// The expected hash map is baked into the bundle at build time by
// vite.config.ts (via the __ARTIFACT_HASHES__ define, populated from
// public/manifest.json). Every consumer fetches through fetchJsonVerified
// and we throw on mismatch — so CDN tampering, truncated responses, and
// stale worker caches surface loudly instead of rendering bad data.
//
// In dev the manifest may be missing or stale; if we have no expected hash
// for an artifact we skip verification rather than break local workflows.

const EXPECTED: Record<string, string> = (
  typeof __ARTIFACT_HASHES__ !== "undefined" ? __ARTIFACT_HASHES__ : {}
);

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function expectedHash(name: string): string | undefined {
  return EXPECTED[name];
}

export async function fetchVerified(url: string, name: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const expected = EXPECTED[name];
  if (expected) {
    const actual = await sha256Hex(buf);
    if (actual !== expected) {
      throw new Error(
        `${name} integrity check failed (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`
      );
    }
  }
  return buf;
}

export async function fetchJsonVerified<T = unknown>(url: string, name: string): Promise<T> {
  const buf = await fetchVerified(url, name);
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}
