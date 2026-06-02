# Deployment & Handoff Runbook

Standing up RedLens' Sky Atlas on Railway. The system is **one web service + a
pgvector Postgres** in a Railway project, plus the **`atlas-update.yml` GitHub
workflow** (required — see §4).

The web service serves the reader SPA, the MCP endpoint, `/health`, and the
chat/OAuth endpoints, and runs an **in-process self-updater** that keeps the atlas
text fresh between deploys (polls upstream, hot-swaps in memory, no restart).
Design detail: [plans/atlas-runtime-freshness-inprocess.md](plans/atlas-runtime-freshness-inprocess.md).

## 0. Prerequisites

- GitHub repo access + a Railway account.
- **OpenRouter API key** (embeddings + chat).
- For chat login only: a **GitHub OAuth app** (client id/secret) + a generated **JWT secret**.

## 1. Project + Postgres

1. Create a Railway project and deploy this repo as a service.
2. Add a **Postgres with the `pgvector` extension** (Railway's pgvector template,
   or the `pgvector/pgvector` image). Plain Postgres fails on first boot.
3. Railway provides **`DATABASE_URL`** to the service automatically.

## 2. Environment variables

Set on the web service (`PORT` is injected by Railway):

| Purpose | Vars |
|---|---|
| **Required** | `DATABASE_URL` (auto), `OPENROUTER_API_KEY` |
| **Atlas auto-update** | `ATLAS_UPDATE_ENABLED=1` |
| **Chat** (optional) | `CHAT_JWT_SECRET` (+ `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` for login) |

Sensible defaults that rarely need changing: `EMBED_MODEL`, `CHAT_MODEL`,
`ATLAS_UPDATE_INTERVAL_MS` (5 min), `APP_URL` (derives from the Railway domain).

**Service settings:** ~1 GB RAM and a **single replica** (the updater is
single-container by design).

## 3. Deploy & verify

The build pulls the atlas submodule and builds all artifacts; the start command
migrates + syncs Postgres, serves, kicks `sync:embeddings` in the background, and
starts the updater.

1. Generate a public domain. `GET /health` should return `{ status, atlas_sha, docs }`.
2. Search works immediately (lexical); semantic search fills in once embeddings
   finish in the background (the first run embeds the whole atlas — takes a while).
3. With `ATLAS_UPDATE_ENABLED=1`, when upstream advances the web logs show
   `atlas-updater: … updated → live now <sha>` and `/health.atlas_sha` advances —
   no redeploy. If you instead see a `git fetch` error, the atlas submodule's git
   data didn't make it into the runtime image (the updater needs `git` + the
   submodule present at runtime).

## 4. Keep `atlas-update.yml` running (required — keeps history current)

The GitHub workflow pulls the submodule, rebuilds artifacts **including
`history/*.json`**, and opens a PR; merging it updates the repo baseline and
redeploys. The in-process updater keeps the running atlas text fresh between
deploys but **does not refresh history** — so `atlas-update.yml` is what keeps the
history view current (until history is moved into the live loop).

## Ongoing operation

- Atlas text refreshes automatically (~5 min after an upstream commit), no redeploy.
- History stays current via `atlas-update.yml` merges.
- On-chain data (`addresses.json`, `chain-state.json`) refreshes on its own cadence
  via `build:addresses` / `build:snapshot` (need Etherscan / RPC keys); not part of
  the atlas loop.

## Gotchas

- **Postgres must have `pgvector`** — plain Postgres fails at first boot.
- **Single replica, ~1 GB RAM.**
- **`ATLAS_UPDATE_ENABLED` is off unless set** — without it the atlas only refreshes
  on a redeploy.
- **The runtime image must keep `git` + the atlas submodule** so the updater can
  fetch — the one thing to confirm on the first live deploy.
