/**
 * Address enrichment: chainlog + Etherscan getsourcecode lookups, with a
 * read-through disk cache.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CACHE_DIR = path.join(ROOT, ".cache/etherscan");

const CHAINLOG_URL = "https://chainlog.skyeco.com/api/mainnet/active.json";
const ETHERSCAN_BASE = "https://api.etherscan.io/v2/api";

const CHAIN_ID = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  avalanche: 43114,
  gnosis: 100,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Cache I/O
// ---------------------------------------------------------------------------
function cachePath(chainid, addr) {
  return path.join(CACHE_DIR, String(chainid), `${addr}.json`);
}

async function readCache(chainid, addr) {
  try {
    const raw = await fs.readFile(cachePath(chainid, addr), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeCache(chainid, addr, entry) {
  const p = cachePath(chainid, addr);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(entry, null, 2));
}

// ---------------------------------------------------------------------------
// Chainlog
// ---------------------------------------------------------------------------
export async function fetchChainlog() {
  try {
    const res = await fetch(CHAINLOG_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // chainlog shape: { "MCD_VAT": "0x35D1…", ... }
    const inverted = {};
    for (const [name, addr] of Object.entries(data)) {
      if (typeof addr === "string" && addr.startsWith("0x")) {
        inverted[addr.toLowerCase()] = name;
      }
    }
    return inverted;
  } catch (err) {
    console.warn(`! chainlog fetch failed (${err.message}) — proceeding without chainlog labels`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Etherscan getsourcecode
// ---------------------------------------------------------------------------
async function fetchEtherscan(chainid, addr, apiKey) {
  const url = `${ETHERSCAN_BASE}?chainid=${chainid}&module=contract&action=getsourcecode&address=${addr}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${chainid}/${addr}`);
  const data = await res.json();
  // Negative response shape: { status: "0", message: "NOTOK", result: "..." }
  if (data.status === "0" && typeof data.result === "string") {
    // Treat as unverified / unknown — cache an empty entry so we don't retry.
    return makeEntry(chainid, addr, {
      ContractName: "",
      ABI: "",
      Proxy: "0",
      Implementation: "",
      SourceCode: "",
    });
  }
  const result = Array.isArray(data.result) ? data.result[0] : null;
  if (!result) {
    return makeEntry(chainid, addr, {
      ContractName: "",
      ABI: "",
      Proxy: "0",
      Implementation: "",
      SourceCode: "",
    });
  }
  return makeEntry(chainid, addr, result);
}

function makeEntry(chainid, addr, r) {
  return {
    fetchedAt: new Date().toISOString(),
    chainid,
    address: addr,
    contractName: typeof r.ContractName === "string" ? r.ContractName : "",
    abi: typeof r.ABI === "string" && r.ABI !== "Contract source code not verified" ? r.ABI : "",
    proxy: r.Proxy === "1" || r.Proxy === 1 || r.Proxy === true,
    implementation:
      typeof r.Implementation === "string" && r.Implementation.startsWith("0x")
        ? r.Implementation.toLowerCase()
        : "",
    sourceCode: typeof r.SourceCode === "string" ? r.SourceCode : "",
  };
}

// ---------------------------------------------------------------------------
// Label resolution
// ---------------------------------------------------------------------------
function resolveLabel(chainlogId, atlasLabel, etherscanName) {
  return chainlogId || atlasLabel || etherscanName || null;
}

// ---------------------------------------------------------------------------
// Main per-address enrichment loop
// ---------------------------------------------------------------------------
export async function enrichAddresses(atlas, chainlog, apiKey) {
  const out = {};
  let misses = 0;
  let errors = 0;
  let processed = 0;
  const total = Object.keys(atlas).length;

  for (const [addr, info] of Object.entries(atlas)) {
    processed++;

    // Solana — pass through unchanged. Etherscan doesn't cover it; chainlog is
    // mainnet only. The atlas-derived label is the best we have.
    if (info.chain === "solana") {
      out[addr] = {
        chain: info.chain,
        explorerUrl: info.explorerUrl,
        label: info.entityLabel,
        isContract: false,
        isProxy: false,
        roles: info.roles,
        aliases: info.aliases,
        expectedTokens: info.expectedTokens,
      };
      continue;
    }

    const chainid = CHAIN_ID[info.chain] ?? 1;

    let entry = await readCache(chainid, addr);
    if (!entry) {
      try {
        entry = await fetchEtherscan(chainid, addr, apiKey);
        await writeCache(chainid, addr, entry);
        misses++;
        if (misses % 25 === 0) {
          console.log(`  … ${processed}/${total} processed, ${misses} cache misses`);
        }
        await sleep(250);
      } catch (err) {
        errors++;
        console.warn(`! ${chainid}/${addr}: ${err.message}`);
        // Treat as empty so the build continues.
        entry = {
          fetchedAt: new Date().toISOString(),
          chainid,
          address: addr,
          contractName: "",
          abi: "",
          proxy: false,
          implementation: "",
          sourceCode: "",
        };
      }
    }

    const chainlogId = chainid === 1 ? chainlog[addr] : undefined;
    const etherscanName = entry.contractName || undefined;
    const label = resolveLabel(chainlogId, info.entityLabel, etherscanName);

    // Aliases: every distinct non-winning candidate label, plus the atlas's own
    // alias list, de-duped, sorted, excluding the resolved winner.
    const candidates = [chainlogId, info.entityLabel, etherscanName].filter(
      (l) => l && l !== label,
    );
    const aliases = [
      ...new Set([...(info.aliases || []), ...candidates].filter((l) => l && l !== label)),
    ].sort();

    out[addr] = {
      chain: info.chain,
      explorerUrl: info.explorerUrl,
      label,
      ...(chainlogId ? { chainlogId } : {}),
      ...(etherscanName ? { etherscanName } : {}),
      isContract: Boolean(etherscanName),
      isProxy: entry.proxy,
      ...(entry.implementation ? { implementation: entry.implementation } : {}),
      roles: info.roles,
      aliases,
      expectedTokens: info.expectedTokens,
    };
  }

  // Attach stats as a non-enumerable property so callers can read them without
  // contaminating Object.entries(out) iteration.
  Object.defineProperty(out, "__stats", {
    value: { misses, errors },
    enumerable: false,
  });
  return out;
}

// ---------------------------------------------------------------------------
// Fetch implementation ABIs for proxy contracts
//
// fetch-snapshots.mjs reads contracts as proxies using their implementation's
// ABI. Those impl addresses are never in the Atlas itself, so they won't have
// been fetched above. Do a second pass here so the cache is complete before
// the snapshot step runs.
// ---------------------------------------------------------------------------
export async function fetchImplABIs(out, apiKey) {
  const implAddrs = [
    ...new Set(
      Object.values(out)
        .filter((a) => a.isProxy && a.implementation)
        .map((a) => a.implementation),
    ),
  ];

  if (!implAddrs.length) return;

  console.log(`\nFetching implementation ABIs for ${implAddrs.length} proxy contracts…`);
  let implMisses = 0;
  for (const impl of implAddrs) {
    const cached = await readCache(1, impl);
    if (cached) continue;
    try {
      const entry = await fetchEtherscan(1, impl, apiKey);
      await writeCache(1, impl, entry);
      implMisses++;
      console.log(`  cached ${impl} (${entry.contractName || "unverified"})`);
      await sleep(250);
    } catch (err) {
      console.warn(`  ! impl ${impl}: ${err.message}`);
    }
  }
  console.log(`  ${implMisses} new, ${implAddrs.length - implMisses} already cached`);
}
