---
name: address-extraction
description: >
  Knowledge base for on-chain address detection, chain attribution, and
  address classification in RedLens. Use when modifying address-chains.mjs,
  address-annotate.mjs, NodeContent.tsx / NodeContentInner.tsx, or any code
  that reads from addresses.atlas.json / addresses.json. Covers the EVM/Solana
  regex patterns, the load-bearing hex-boundary lookarounds, the three-pass
  chain detection algorithm, the ROLE_VOCAB classification system, and the
  sync constraint between the build pipeline and the frontend renderer.
  Keywords: address-chains, address-annotate, NodeContent, EVM regex, 0x regex,
  chain detection, detectChain, ROLE_VOCAB, entityLabel, expectedTokens,
  addresses.atlas.json, addresses.json, rehypeEthAddresses
license: MIT
metadata:
  author: anscharo
  version: "1.0"
---

# address-extraction

**Files this skill covers:**

- `scripts/lib/address-chains.mjs` — EVM/Solana regexes, `detectChain`, table-context detection
- `scripts/lib/address-annotate.mjs` — `ROLE_VOCAB`, `entityLabel`, `expectedTokens` (called from `build-graph` Phase 2.6)
- `src/components/NodeContent.tsx` / `NodeContentInner.tsx` — `rehypeEthAddresses` plugin that linkifies addresses in rendered markdown

**Sync constraint:** `address-chains.mjs` and `NodeContent.tsx` use the same EVM regex. If you change one, change both.

---

## Regex patterns

- **EVM:** `/(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g`
- **Solana:** `/\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g` (base58, 43–44 chars — assumed Solana by pattern alone)

### Load-bearing hex-boundary lookarounds

The negative lookarounds on the EVM pattern (`(?<![0-9a-fA-F])` before and `(?![0-9a-fA-F])` after) are **not optional**. Without them, the regex matches the leading 40 hex chars of any longer hex blob:

- Transaction hashes (64 hex)
- `bytes32` constants
- Role IDs / domain separators
- Raw calldata

This ships phantom addresses into `addresses.json` that don't correspond to real contracts. Both the build pipeline and the frontend renderer must use the exact same boundary form.

### 64-hex values are never linked

`0x` + 64 hex chars (tx hashes, `bytes32` values, role IDs, domain separators) are **not linked** even though they start with `0x`. These are are visually identical to each other and cannot be reliably distinguished from context.
 
---

## Chain detection (`detectChain`)

Three-pass priority — first match wins:

1. **Explicit phrase** — `address on [the] CHAIN is` in the 120 chars before the address. Most reliable: the author stated the chain explicitly.
2. **Tight-window keyword scan** — chain-name keywords in the 120 chars before.
3. **Wide-window keyword scan** — chain-name keywords in the 300 chars before.
4. **Fallback** — `ethereum`.

**Supported chains and their block explorers:**

| Chain     | Explorer                    |
|-----------|-----------------------------|
| ethereum  | etherscan.io                |
| base      | basescan.org                |
| arbitrum  | arbiscan.io                 |
| optimism  | optimistic.etherscan.io     |
| polygon   | polygonscan.com             |
| avalanche | snowtrace.io                |
| gnosis    | gnosisscan.io               |
| solana    | solscan.io                  |

---

## Address classification

Runs in `build-graph` Phase 2.6 (via `address-annotate.mjs`). Each address gets three annotation fields written into `public/addresses.atlas.json`:

- **`roles: string[]`** — flat multi-tag array from the closed vocabulary `ROLE_VOCAB`. Multiple roles per address are supported.
- **`entityLabel: string`** — best-effort proper-noun phrase extracted from the 200 chars before the address in the atlas text.
- **`expectedTokens: string[]`** — token symbols (e.g. `USDS`, `SKY`, `MKR`) mentioned within ±300 chars of the address.

`ROLE_VOCAB` is the authoritative closed list of role tags. Add new roles there, not ad hoc in call sites.

---

## Address artifact split

Two separate artifacts — never mix their fields:

| Artifact | Owner | Fields |
|---|---|---|
| `public/addresses.atlas.json` | `build-index` (initial), `build-graph` Phase 4.5 (enrichment) | `chain`, `explorerUrl`, `roles`, `entityLabel`, `aliases`, `expectedTokens` |
| `public/addresses.json` | `build-addresses` | `chain`, `chainlogId?`, `etherscanName?`, `isContract`, `isProxy`, `implementation?` |

`build-addresses` must never write atlas annotation fields into `addresses.json`.

The frontend `loadAddresses()` loads both in parallel, merges per-address, and resolves `label = chainlogId ?? entityLabel ?? etherscanName`.
