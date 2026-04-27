# RedLens' Sky Atlas

A search-first interface for the Sky ecosystem's [next-gen-atlas](https://github.com/sky-ecosystem/next-gen-atlas). The atlas is included as a git submodule at `vendor/next-gen-atlas/`; the source document is `vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md` (~48k lines, 9,825 nodes).

**Atlas Markdown syntax reference**: `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md` — canonical spec for heading format, document numbering, document types, extra fields, and nesting rules. Read this before touching the parser.

## Stack

- **Build/dev**: Vite+ (`vp`) + pnpm + TypeScript
- **UI**: React 19 + Tailwind v4 (via `@tailwindcss/vite`)
- **Search**: lunr.js (full-content index, runs in a Web Worker)
- **Markdown**: react-markdown + remark-gfm + remark-math + rehype-katex (KaTeX)
- **Custom rehype plugin**: linkifies on-chain addresses to block explorers
- **Graph**: graphology (in a Web Worker) for node relations and backlinks

## Commands

```bash
pnpm build:index     # parses Sky Atlas.md → public/docs.json + public/search-index.json
pnpm build:glossary  # extracts Definitions sections → public/glossary.json
pnpm build:addresses # chainlog + Etherscan enrichment → public/addresses.json
pnpm build:snapshot  # viem multicall snapshots → public/chain-state.json
pnpm build:graph     # relation extraction → public/graph.json + public/relations.json
pnpm build:history   # git log of atlas submodule → public/history/<uuid>.json
pnpm build:manifest  # sha256 digest of all artifacts → public/manifest.json
pnpm build:at        # reproducible build at a specific atlas commit
pnpm build:rag       # embedding vectors → .cache/atlas-rag/ (offline, not in main build)
pnpm dev             # vite dev server
pnpm build           # full pipeline: index → glossary → addresses → snapshot → graph → manifest → tsc → vite
```

The Vite+ binary lives at `~/.vite-plus/0.1.16/bin/vp` (it cannot be run via `pnpm dlx`).

## Architecture

### Data pipeline

Each build pass is its own script. They run in order in `pnpm build`:

Scripts are split: `scripts/required/` holds the build pipeline entry-points wired into `pnpm build:*`; `scripts/lib/` holds shared modules (parsing, regexes, extraction phases) imported by those entry-points; `scripts/aux/` holds offline / one-off / experimental scripts (`fetch-snapshots`, `build-rag`, `query-rag`, `walk-timeline`, `tva.sh`, etc.) that are not part of the core build chain.

- **`scripts/required/build-index.mjs`** — parses `Sky Atlas.md`, emits `public/docs.json` (`Record<uuid, AtlasNode>`) and `public/search-index.json` (serialized lunr index). Full-content indexing is intentional — search quality over bundle size. Imports `lib/atlas-parser.mjs`, `lib/address-chains.mjs`, `lib/address-annotate.mjs`, `lib/address-merge.mjs`.
- **`scripts/required/build-glossary.mjs`** — finds all `Definitions` sections, collects direct `[Core]` children as terms, emits `public/glossary.json` keyed by lowercased term.
- **`scripts/required/build-addresses.mjs`** — fetches Sky chainlog, calls Etherscan `getsourcecode` per unique address (read-through disk cache at `.cache/etherscan/<chainid>/<addr>.json`), emits `public/addresses.json`. Imports `lib/address-enrich.mjs`.
- **`scripts/required/build-graph.mjs`** — pattern-driven relation extraction, emits `public/graph.json` (node graph) and `public/relations.json` (typed edges). See `.claude/skills/graph-atlas/SKILL.md` for the full relationship reference. Imports `lib/graph-patterns.mjs`, `lib/graph-instances.mjs`, `lib/graph-entities.mjs` (Phase 1), `lib/graph-doc-edges.mjs` (Phase 2 doc edges 2a–2h), `lib/graph-entity-edges.mjs` (Phase 2 entity/address edges 2i–2w).
- **`scripts/required/build-history.mjs`** — walks git log of the atlas submodule, emits `public/history/<uuid>.json` per node. Imports `lib/atlas-parser.mjs` for `HEADING_RE`.
- **`scripts/required/build-manifest.mjs`** — sha256 digest of every shipping artifact; `vite.config.ts` reads it at build time for integrity verification.
- **`scripts/required/build-at.mjs`** — reproducible build at a pinned atlas commit; orchestrates the other `build:*` scripts.

Heading regex (each node):
```
^(#{1,6}) ([\w.-]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->$
```

Each node has: `id` (uuid), `doc_no` (e.g. `A.0.1.1`), `title`, `type`, `depth` (heading level 1–6, **capped at 6** — semantic depth from the doc number may exceed 6), `parentId`, `order`, `content`, `addressRefs`. Parent IDs are resolved via a depth-indexed ancestor stack.

**Atlas document types** (from the syntax spec): Scope, Article, Section, Core, Type Specification, Active Data Controller, Annotation, Action Tenet, Scenario, Scenario Variation, Active Data, Needed Research. Supporting documents (Annotations, Action Tenets, Scenarios, Scenario Variations, Active Data) use special directory-number patterns (`.0.3.X`, `.0.4.X`, `.1.X`, `.varX`, `.0.6.X`). Needed Research uses global `NR-X` numbering.

`cleanContent()` strips wrapping single-backtick markers from multi-line backtick blocks (an Atlas authoring quirk) — but does NOT remove code/backtick *content*.

### On-chain address extraction

Detected at build time in `scripts/required/build-index.mjs` (regex + chain detection live in `scripts/lib/address-chains.mjs`; role/label/token annotation in `scripts/lib/address-annotate.mjs`). Each node stores `addressRefs: string[]` pointing into the shared `addresses.json`.

**Patterns:**
- EVM: `/(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g`
- Solana: `/\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g` (base58, 43–44 chars — assumed Solana by pattern alone)

The hex-boundary lookarounds on the EVM pattern are **load-bearing**: without them, the regex matches the leading 40 hex chars of any longer hex blob — transaction hashes (64 hex), bytes32 values, raw calldata — and ships those phantom addresses into `addresses.json`. Both `scripts/lib/address-chains.mjs` (consumed by `build-index`) and `src/components/NodeContent.tsx` use the same boundary form and must stay in sync. If you change one, change both.

**0x + 64 hex values** (tx hashes, bytes32 constants, role IDs, domain separators, etc.) are **not linked** — they are visually identical and cannot be reliably distinguished from context.

**Chain detection (`detectChain`)** — three-pass priority:
1. Explicit phrase: `address on [the] CHAIN is` in the 120 chars before the address (most reliable signal — user explicitly asked for this).
2. Tight-window keyword scan (120 chars before).
3. Wide-window keyword scan (300 chars before).
4. Fallback: `ethereum`.

Supported chains/explorers: ethereum, base, arbitrum, optimism, polygon, avalanche, gnosis, solana.

**Address classification:** each address gets:
- `roles`: `string[]` — flat multi-tag array from a closed vocabulary (`ROLE_VOCAB` in `scripts/lib/address-annotate.mjs`).
- `entityLabel`: best-effort proper-noun phrase pulled from the 200 chars before the address.
- `expectedTokens`: `string[]` of token symbols mentioned within ±300 chars.

### Frontend

`App.tsx` is the shell (routing, URL sync, layout). The main atlas view is `src/components/atlas/AtlasView.tsx`.

**Workers:**
- **`src/workers/search.worker.ts`** — loads `docs.json` + `search-index.json`, runs lunr queries, generates highlighted snippets. Phrase post-filter: `"quoted"` phrases are stripped before the lunr query, then every hit is checked for literal substring containment.
- **`src/workers/atlas.worker.ts`** — loads and parses `docs.json` for the atlas tree view.
- **`src/workers/graph.worker.ts`** — loads `relations.json` into a graphology `MultiDirectedGraph`; answers edge queries, BFS neighbor/subgraph requests for the main thread.

**Atlas view (`src/components/atlas/`):**
- **`AtlasView.tsx`** — main atlas page. Loads atlas + addresses + chain-state + glossary in parallel. Renders a flat virtualized list via `CollapsibleNode`. Computes `linkedNodes`, `targetAddresses`, `glossaryTerms` in a single `useMemo` keyed on `[data, id]`. Passes everything to `RightPanel`.
- **`CollapsibleNode.tsx`** — single row in the atlas tree. Expand/collapse, depth-based indent, renders node content via `NodeContent`. Nodes at depth ≥ 6 are hidden behind a "view all descendants" button until expanded.
- **`RightPanel.tsx`** — right annotations panel. Tabs: `annotations` (linked docs, backlinks, graph relations, addresses, glossary terms, integrity) and `history`. All data arrives as props from `AtlasView`.
- **`Integrity.tsx`** — shows `doc_no`, `uuid`, `sha256` content hash and provenance link for the selected node.

**Shared components (`src/components/`):**
- **`NodeContent.tsx`** / **`NodeContentInner.tsx`** — markdown rendering. `rehypeEthAddresses` plugin linkifies on-chain addresses; KaTeX loaded lazily on demand. `onNavigate` via React context. UUID hrefs intercepted for SPA navigation.
- **`RelatedNode.tsx`** — linked-node card in the right panel.
- **`AddressCard.tsx`** — address card with entity label, aliases, explorer link, role pills.
- **`SearchBar.tsx`** — header: home link, search input, scope filter pills.
- **`SearchResults.tsx`** / **`SearchResult.tsx`** — result list and individual result card.
- **`SearchHints.tsx`** — idle-state syntax cheat sheet.

**Hooks / lib:**
- **`src/hooks/useSearch.ts`** — debounced search hook with pending-id race guard.
- **`src/lib/docs.ts`** — `loadAtlas()` module-level Promise cache for `docs.json`.
- **`src/lib/addresses.ts`** — `loadAddresses()` module-level cache for `addresses.json`.
- **`src/lib/glossary.ts`** — `loadGlossary()` + `buildLookup()`. Lookup flattens parenthetical aliases (`"Accessibility Scope (ACC)"` → keys for both `"accessibility scope"` and `"acc"`).
- **`src/lib/graph.ts`** — `getEdges()`, `getNeighbors()`, `getSubgraph()` — async wrappers that message the graph worker.
- **`src/lib/atlasHelpers.ts`** — shared helpers (`extractLinkedIds`, `buildAncestors`) and the `LoadedData` interface.

### Base path

`vite.config.ts` sets `base: '/redlens/'`. Any runtime string used as a URL (not an import Vite transforms) MUST be prefixed with `import.meta.env.BASE_URL`. This applies to `fetch(...)` in workers, icon `<img src>`, all `pushState`/`href` links, etc. Hardcoded `"/"` paths will 404 in dev.

### Styling

Color tokens live as CSS variables in `src/index.css`:

- `--bg #160e0d` (charcoal w/ red undertone), `--surface`, `--hover #3a1f1a`
- `--red #a63228`, `--accent #c67267` (links/focus, browner-pinker — *not* the original error-looking red)
- `--tan #f3e7ce` / `--tan-2` / `--tan-3` (tans/browns)
- Fonts: Lora (serif body), Source Code Pro (mono)
- KaTeX is overridden to use `--tan` color

Selected-node treatment: red left bar, transparent background, brighter text. Don't add backgrounds to the selected node.

## Conventions / preferences

- **Don't add hover/click logic in JS when CSS will do it.**
- **The home button is a plain HTML link** (`<a href="/">`), not an `onClick` handler.
- **Search quality > bundle size** for the lunr index. Full-content indexing is intentional.
- **Scroll-to is `behavior: "instant"`**, not smooth — the user found smooth scrolling sluggish.
- **Sticky header collisions**: any scroll target needs `scrollMarginTop: "64px"`.
- **Don't override git user.name/email.** Trust global config.
- **Show stats before touching the UI** when changing the build pipeline. The user wants to see counts/samples before any visual change consumes new data.
- **Each build pass gets its own script** (`scripts/required/build-<thing>.mjs`) and its own `pnpm build:<thing>`. Don't add new passes to `build-index.mjs`. Shared logic belongs in `scripts/lib/`.
- **Max 3 components per file** (only if 2 are <8 lines); max ~150 lines per file.

## Pending work

### Deferred: snapshot pass (view values + balances)

`public/chain-state.json` exists but is populated by `scripts/aux/fetch-snapshots.mjs`. The frontend reads it via `loadChainState()` and `AddressCard` displays values. What's deferred:

- Full multicall3 batching via viem for hundreds of view-function reads.
- GitHub Actions cron refresh (daily for balances, weekly for state).
- Atlas/chain drift detection: diff atlas-stated values against snapshot values at build time, surface warnings in the UI.

### Other / background

- **Reduce `unknown` role share** — many addresses sit in markdown tables; `findTableContext` / `annotationText` in `scripts/lib/address-chains.mjs` / `scripts/lib/address-annotate.mjs` is partially done, could be tuned.
- **Research [pretext](https://github.com/chenglou/pretext)** — possible way to inline structured data into Atlas content.
- **Thematic views** — `/radar` serves as the agent profile view (Spark, etc.). `/constellations` is the participant graph view. Reports are a third thematic layer.

## File map

```
scripts/required/build-index.mjs    parse Sky Atlas.md → docs.json + search-index.json
scripts/required/build-glossary.mjs extract Definitions → glossary.json
scripts/required/build-addresses.mjs chainlog + Etherscan → addresses.json (cache at .cache/etherscan/)
scripts/required/build-graph.mjs    relation extraction → graph.json + relations.json
scripts/required/build-history.mjs  git log of atlas submodule → history/<uuid>.json
scripts/required/build-manifest.mjs sha256 of artifacts → manifest.json
scripts/required/build-at.mjs       reproducible build at a pinned atlas commit
scripts/lib/atlas-parser.mjs        HEADING_RE + parse() + cleanContent() + sha256
scripts/lib/address-chains.mjs      EVM/Solana regexes, chain detection, table-context detection
scripts/lib/address-annotate.mjs    role/label/expectedTokens extraction (per-node)
scripts/lib/address-merge.mjs       per-address global merge across nodes
scripts/lib/address-enrich.mjs      chainlog fetch + Etherscan getsourcecode + cache I/O
scripts/lib/graph-patterns.mjs      doc_no/title predicates + content extraction helpers
scripts/lib/graph-instances.mjs     ICD parameter extraction + instance status
scripts/lib/graph-entities.mjs      Phase 1 — entity extraction (extractEntities())
scripts/lib/graph-doc-edges.mjs     Phase 2a–2h — doc-structure edges
scripts/lib/graph-entity-edges.mjs  Phase 2i–2w — entity + address edges
scripts/aux/fetch-snapshots.mjs     viem multicall snapshots → chain-state.json
scripts/aux/build-rag.mjs           offline embeddings → .cache/atlas-rag/
scripts/aux/query-rag.mjs           query the RAG cache from CLI
scripts/aux/test-mcp.mjs            sanity check the local MCP server
scripts/aux/test-addresses.mjs      ad-hoc dumps from public/addresses.json
scripts/aux/walk-timeline.mjs       walk atlas history, build at each commit
scripts/aux/walk-timeline.sh        bash variant of walk-timeline
scripts/aux/tva.sh                  TVA — full-history build + test sweep
public/docs.json                    generated; per-node content + addressRefs[]
public/glossary.json                generated; glossary terms keyed by lowercased term
public/addresses.json               generated; address metadata (no ABIs)
public/graph.json                   generated; node graph
public/relations.json               generated; typed edges for the graph worker
public/chain-state.json             generated; on-chain value snapshots
public/history/<uuid>.json          generated; per-node git history
.cache/etherscan/<chainid>/<addr>   committed; Etherscan getsourcecode cache
src/App.tsx                         shell; routing, URL sync, layout
src/lib/docs.ts                     loadAtlas() module cache
src/lib/addresses.ts                loadAddresses() module cache
src/lib/glossary.ts                 loadGlossary() + buildLookup()
src/lib/graph.ts                    getEdges/getNeighbors/getSubgraph → graph worker
src/lib/atlasHelpers.ts             extractLinkedIds, buildAncestors, LoadedData
src/lib/addressMap.ts               module-level shared map for rehype plugin
src/workers/search.worker.ts        lunr query + phrase post-filter
src/workers/atlas.worker.ts         docs.json loader/parser
src/workers/graph.worker.ts         graphology BFS + edge queries
src/hooks/useSearch.ts              debounced search hook
src/components/atlas/AtlasView.tsx  main atlas page; data loading + layout
src/components/atlas/CollapsibleNode.tsx  tree row; expand/collapse
src/components/atlas/RightPanel.tsx annotations + history panel
src/components/atlas/Integrity.tsx  doc_no / uuid / sha256 display
src/components/NodeContent.tsx      lazy markdown renderer wrapper
src/components/NodeContentInner.tsx markdown + KaTeX + rehypeEthAddresses
src/components/RelatedNode.tsx      linked-node card
src/components/AddressCard.tsx      address card with roles + aliases
src/components/SearchBar.tsx        header: home link, input, scope pills
src/components/SearchResults.tsx    result list + status line
src/components/SearchResult.tsx     single result card
src/components/SearchHints.tsx      idle-state syntax hints
src/components/ConstellationsPage.tsx  /constellations route — participant graph (agents, parties, instances)
src/components/entities/EntityFlow.tsx ReactFlow canvas + card + relation chips
src/lib/entityGraph.ts              ENTITY_TYPE_LABEL/COLOR, buildEntityNodes/Edges/Index, getEntityRelations
src/lib/entitySearch.ts             searchParticipants, neighborhoodOfParticipants, agentClusterIds
src/types.ts                        AtlasNode, Participant, SearchHit, AddressInfo, worker messages
src/index.css                       Tailwind import + CSS variables + KaTeX overrides
index.html                          title, fonts, favicon, preload links
vite.config.ts                      base: '/redlens/', integrity hashing
vendor/next-gen-atlas/              git submodule — Atlas source
.github/workflows/                  CI/CD
```
