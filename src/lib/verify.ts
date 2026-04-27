// sha256 verification for shipped JSON artifacts.
//
// The expected hash map is baked into the bundle at build time by
// vite.config.ts (via the __ARTIFACT_HASHES__ define, populated from
// public/manifest.json). Every consumer fetches through fetchJsonVerified
// and we warn on mismatch — CDN tampering, truncated responses, and stale
// worker caches surface in the console without breaking the app.
//
// Verification is skipped in dev: Vite only reads manifest.json at
// dev-server startup, so any subsequent build rewrites hashes on disk and
// the bundled hashes go stale. Integrity is a production concern — in dev
// we trust the local filesystem.

const EXPECTED: Record<string, string> = import.meta.env.DEV
  ? {}
  : typeof __ARTIFACT_HASHES__ !== "undefined"
    ? __ARTIFACT_HASHES__
    : {};

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
      console.warn(
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
