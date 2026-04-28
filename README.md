# RedLens — Sky Atlas

A search-first reader for the [Sky Atlas](https://github.com/sky-ecosystem/next-gen-atlas), the canonical document describing the Sky ecosystem's structure, governance, and operations.

An alternative to [sky-atlas.io](https://sky-atlas.io) with a focus on surfacing the on-chain reality behind the governance text.

## Features

### Search

- **Full-content search** — every node of the Atlas is indexed (lunr.js, Web Worker), so queries hit the entire ~48k-line corpus instantly
- **Chainlog ID search** — type `MCD_VAT`, `USDS`, `REWARDS_LSSKY_SKY`, etc. to find all nodes that reference that contract
- **Address prefix search** — type `0x` or any address prefix to find nodes containing matching addresses
- **Phrase search** — wrap terms in quotes for exact substring matching: `"surplus buffer"`
- **Field filters** — `title:quorum`, `type:Annotation`, `type:Core`
- **Fuzzy match** — `misaligment~1` tolerates typos
- **Wildcards** — `govern*` matches any suffix

### Atlas reader

Navigate any atlas document to see its full content alongside a contextual annotations panel: linked documents, on-chain addresses, glossary terms, and a change history tab.

### On-chain annotations

Every Ethereum and Solana address mentioned in the Atlas is detected at build time and enriched from two sources:

- **Sky chainlog** — ~400 mainnet contract names mapped to their canonical label
- **Etherscan** — verified contract name, proxy flag, and implementation address; cached and committed so contributors don't need an API key

Address cards show the resolved label, aliases, explorer link, role tags, proxy → implementation, and cached on-chain view-function values.

### Radar

`/radar` — actor profiles for Prime Agents, Facilitators, and other named Sky participants. Shows responsibilities, instances, rewards, and linked atlas sections.

### Constellations

`/constellations` — a visual graph of agents, governance parties, facilitators, and the typed relationships between them, drawn from the build-time graph extraction.

### Reports

`/reports` — cross-cutting views that join across the graph: rewards by primitive, active data by scope, and org facilitator breakdowns.

## Getting started

Requires [pnpm](https://pnpm.io/) and Node 22+.

```bash
git clone --recurse-submodules https://github.com/Anscharo/redlens.git
cd redlens
pnpm install
```

If you cloned without `--recurse-submodules`, run `git submodule update --init --recursive` to pull the Atlas source.

### Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
ETHERSCAN_API_KEY=   # https://etherscan.io/apidashboard — needed for build:addresses
ETH_RPC_URL=         # optional; defaults to ethereum.publicnode.com
```

The Etherscan cache is committed to the repo — if you're not adding new addresses, `build:addresses` completes in under a second with zero API calls.

### Build and run

```bash
pnpm build   # full pipeline (see below) + tsc + vite build
pnpm dev     # Vite dev server (run pnpm build first to generate the data files)
pnpm preview # serve the production build locally
```

## Build pipeline

`pnpm build` runs six data-extraction stages in order before the TypeScript and Vite steps:

| Stage | What it does |
|---|---|
| `build:index` | Parses Sky Atlas.md → node index + full-text search index |
| `build:glossary` | Extracts Definitions sections → glossary lookup |
| `build:addresses` | Enriches on-chain addresses from chainlog + Etherscan → address metadata |
| `build:snapshot` | Reads view-function values via RPC → chain state pinned to a block |
| `build:graph` | Extracts typed relationships from the atlas text → graph artifacts |
| `build:manifest` | sha256 digest of all artifacts → integrity manifest |

Each stage can also be run individually. See the [provenance page](https://anscharo.github.io/redlens/redlens/provenance) for a description of what each stage powers in the UI.

### Build at any historical atlas commit

The atlas is a moving target. To audit RedLens against a specific atlas revision:

```bash
pnpm build:at <atlas-commit-sha>   # e.g. ede66d5f2cf3…
```

This runs only the deterministic, offline pipeline steps and pins the output manifest to the given commit. No API keys needed. Two people running the same command at the same SHA get byte-identical outputs. CI enforces this on every push via `REPRO=1 pnpm test`.

### Per-node history

```bash
pnpm build:history   # walks the atlas git history → public/history/<uuid>.json per node
```

This is not part of `pnpm build` — it's slow and requires GitHub API access for PR metadata. Run it manually when you want the history tab populated.

## Deployment

`main` is auto-deployed to GitHub Pages via `.github/workflows/deploy.yml`. The workflow runs on every push to `main`, daily on a schedule, and on manual trigger. It requires two repository secrets: `ETHERSCAN_API_KEY` and `ETH_RPC_URL`.

## Other tools

These are not part of the web app build and are not required for local development.

### Local Atlas MCP server

`mcp-atlas/` contains a local [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes the Sky Atlas as queryable tools for Claude Code. It uses a local vector index over the node index so you can ask natural-language questions about the Atlas without sending data off your machine.

```bash
pnpm build:rag   # build the vector index (requires Ollama + nomic-embed-text, ~2 min)
pnpm query "what is spark"   # direct RAG query without the MCP layer
```

The repo ships a `.mcp.json` so any Claude Code session in this directory auto-discovers the server. Requires [Ollama](https://ollama.com/) running locally with `ollama pull nomic-embed-text`.

### Hosted MCP server + Worker

`redlens-mcp/` is a Cloudflare Worker that hosts a public MCP endpoint and REST API, backed by a D1 graph database containing all atlas nodes, the typed edge graph, named entities, and on-chain address data.

**Endpoint:** `https://redlens-mcp.anscharo.workers.dev/mcp`

See [`redlens-mcp/AGENTS.md`](redlens-mcp/AGENTS.md) for the full tool reference, REST API, database schema, and deployment instructions.

### Auxiliary scripts

`scripts/aux/` holds scripts that are useful for development and research but are not part of the core build:

| Script | Purpose |
|---|---|
| `fetch-snapshots.mjs` | The implementation behind `build:snapshot` — multicall3 via viem |
| `build-rag.mjs` | Builds the local vector index for the MCP server |
| `query-rag.mjs` | CLI query against the local RAG index |
| `walk-timeline.mjs` | Walk the full atlas history and build at each commit |
| `tva.sh` | Full-history build + test sweep |
| `test-addresses.mjs` | Ad-hoc dumps from address metadata |
| `test-mcp.mjs` | Exercises the local MCP server JSON-RPC protocol |
