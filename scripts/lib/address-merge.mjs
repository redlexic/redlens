/**
 * Global address merge — collapses per-node annotations into a single canonical
 * entry per address.
 */

import { EXPLORER } from "./address-chains.mjs";

// Per-node extraction produces different annotations depending on the local
// context. The same address can have a rich label in one node (e.g. "Spark
// Operations Multisig" from a prose sentence) and nothing in another (e.g. a
// bare address in a Setter leaf node). This pass merges every address's
// annotation data across all nodes into a single canonical entry, then rewrites
// each node's address map to point at that entry. After this pass, looking up
// an address in any node yields the same label / roles / tokens.
export function mergeAddressAnnotations(nodes) {
  // Pass 1 — aggregate every occurrence into a global table
  const global = {}; // key → { chains: Set, labels: Set, roles: Set, tokens: Set }

  for (const node of nodes) {
    for (const [addr, info] of Object.entries(node.addresses || {})) {
      let g = global[addr];
      if (!g) {
        g = global[addr] = {
          chains: new Set(),
          labels: new Set(),
          roles: new Set(),
          tokens: new Set(),
        };
      }
      g.chains.add(info.chain);
      if (info.entityLabel) g.labels.add(info.entityLabel);
      for (const r of info.roles) g.roles.add(r);
      for (const t of info.expectedTokens) g.tokens.add(t);
    }
  }

  // Pass 2 — canonicalize each entry
  const GENERIC_LABELS = new Set([
    "contract", "address", "registry", "multisig", "the contract",
    "the address", "the multisig", "agreement",
  ]);
  const merged = {};
  for (const [addr, g] of Object.entries(global)) {
    // Chain: prefer any non-default detection over the ethereum fallback.
    // If only "ethereum" was ever detected, keep it.
    const chains = [...g.chains];
    const specific = chains.find((c) => c !== "ethereum");
    const chain = specific ?? chains[0] ?? "ethereum";

    // Label: filter out generic single-word labels; pick the longest remaining.
    // Ties broken by lexicographic order for determinism.
    const labelPool = [...g.labels];
    const nonGeneric = labelPool.filter(
      (l) => !GENERIC_LABELS.has(l.toLowerCase())
    );
    const candidates = nonGeneric.length ? nonGeneric : labelPool;
    let entityLabel = null;
    if (candidates.length) {
      candidates.sort((a, b) => b.length - a.length || a.localeCompare(b));
      entityLabel = candidates[0];
    }

    const aliases = entityLabel
      ? [...new Set(labelPool.filter((l) => l !== entityLabel).map((l) => l.trim()))].sort()
      : [];

    merged[addr] = {
      chain,
      explorerUrl: EXPLORER[chain] + addr,
      roles: [...g.roles].sort(),
      entityLabel,
      aliases,
      expectedTokens: [...g.tokens].sort(),
    };
  }

  // Pass 3 — rewrite every node's address map to point at merged entries
  for (const node of nodes) {
    if (!node.addresses) continue;
    const rewritten = {};
    for (const addr of Object.keys(node.addresses)) {
      rewritten[addr] = merged[addr];
    }
    node.addresses = rewritten;
  }

  return merged;
}
