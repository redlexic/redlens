# Deployment & Handoff Runbook

Standing up Redline Atlas on Railway. The system is **one web service + a
Postgres** in a Railway project, plus the **`atlas-update.yml` GitHub workflow**
(required — see §5).

The web service serves the reader SPA, the MCP endpoint, `/health`, and the
chat/OAuth endpoints, and runs an **in-process self-updater** that keeps the atlas
text fresh between deploys (polls upstream, hot-swaps in memory, no restart).
Design detail: [plans/atlas-runtime-freshness-inprocess.md](plans/atlas-runtime-freshness-inprocess.md).

The web service builds from a **`Dockerfile`** (`railway.toml` sets
`builder = "DOCKERFILE"`). The Dockerfile clones the atlas itself — Railway strips `.git` and doesn't recurse
submodules, so a build-time `git submodule update` can't work.

## 0. Prerequisites

- GitHub repo access + a Railway account, and the **Railway CLI** (`railway`,
  logged in: `railway login`).
- **OpenRouter API key** (embeddings + chat).
- For chat login only: a **GitHub OAuth app** (client id/secret) + a generated **JWT secret**.

## 1. Project, Postgres, and wiring — via the CLI

Railway's **managed Postgres already includes `pgvector`** — no special image or
template needed. The first migration runs `CREATE EXTENSION IF NOT EXISTS vector`.

```bash
# Link this repo to a Railway project + environment (interactive: pick/create).
railway link

# Provision managed Postgres (service is named "Postgres" by default).
railway add -d postgres

# Deploy the repo as the web service if it isn't already one (interactive),
# then note its service name (this runbook uses "redline-atlas").
railway status        # shows project, environment, and services

# ── The load-bearing step ──────────────────────────────────────────────────
# Railway does NOT auto-inject the DB URL into the web service. You MUST point
# the web service's DATABASE_URL at the Postgres service via a reference
# variable (resolves to the PRIVATE host postgres.railway.internal — no SSL).
# Skipping this is the #1 failure: DATABASE_URL falls back to the localhost
# default and the container crash-loops on ERR_POSTGRES_CONNECTION_CLOSED.
railway variables --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --service redline-atlas
```

If the Postgres service has a non-default name, match it in the reference:
`${{<ServiceName>.DATABASE_URL}}`.

## 2. Environment variables

Set on the **web service** (`PORT` is injected by Railway):

```bash
railway variables --set 'OPENROUTER_API_KEY=sk-or-...'  --service redline-atlas
railway variables --set 'ATLAS_UPDATE_ENABLED=1'        --service redline-atlas
# Chat build only:
railway variables --set 'CHAT_JWT_SECRET=<openssl rand -hex 32>'      --service redline-atlas
railway variables --set 'GITHUB_CLIENT_ID=...'                        --service redline-atlas
railway variables --set 'GITHUB_CLIENT_SECRET=...'                    --service redline-atlas
# Optional: RATE_LIMIT_TOKENS_PER_WINDOW (default 500000), RATE_LIMIT_WINDOW_MINUTES (120)
```

| Purpose | Vars |
|---|---|
| **Required** | `DATABASE_URL` (reference, §1), `OPENROUTER_API_KEY` |
| **Atlas auto-update** | `ATLAS_UPDATE_ENABLED=1` |
| **Chat** (optional) | `CHAT_JWT_SECRET` (+ `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` for login) |

Sensible defaults that rarely need changing: `EMBED_MODEL`, `CHAT_MODEL`,
`ATLAS_UPDATE_INTERVAL_MS` (5 min). Inspect what's set with
`railway variables --service redline-atlas --kv`.

**Service settings:** ~1 GB RAM and a **single replica** (the updater is
single-container by design).

## 3. Deploy & verify

The Docker build clones the atlas (`--branch main`), runs the atlas's
`sync/compose.py` (needs python3 — in the image) to synthesize `Sky Atlas.md`, and
builds all artifacts. The start command waits for Postgres, migrates + syncs,
serves, kicks `sync:embeddings` in the background, and starts the updater.

```bash
railway domain --service redline-atlas         # generate/print the public URL
curl https://<domain>/health             # → { "status": "ok", "atlas_sha": "...", "docs": N }
railway logs --service redline-atlas           # boot logs: "db: connected …", "sync:atlas — done", "listening on :8080"
```

1. `GET /health` returns `{ status, atlas_sha, docs }`.
2. Search works immediately (lexical); semantic search fills in once embeddings
   finish in the background (the first run embeds the whole atlas — takes a while).
3. With `ATLAS_UPDATE_ENABLED=1`, when upstream advances the logs show
   `atlas-updater: … updated → live now <sha>` and `/health.atlas_sha` advances —
   no redeploy.

## 4. Frontend base path

The SPA must build with the apex base (`/`), not the GH-Pages base (`/redlens/`).
The Dockerfile sets `RAILWAY_ENVIRONMENT=production` during the build so
`vite.config.ts` picks `/`. If the browser shows "module script MIME type" errors,
the bundle built with the wrong base — verify with
`curl https://<domain>/ | grep assets` (must be `/assets/…`, not `/redlens/assets/…`).

## 5. Keep `atlas-update.yml` running (required — keeps history current)

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

- **`DATABASE_URL` is NOT auto-wired** — set the `${{Postgres.DATABASE_URL}}`
  reference on the web service (§1), or it crash-loops on the localhost default.
- **Railway's managed Postgres has `pgvector`** — `railway add -d postgres` is
  enough; no special image needed.
- **Builder must be `DOCKERFILE`** — Nixpacks/Railpack can't carry git + python3 +
  the atlas checkout the runtime updater needs.
- **Single replica, ~1 GB RAM.**
- **`ATLAS_UPDATE_ENABLED` is off unless set** — without it the atlas only refreshes
  on a redeploy.
- **Vite base** — the bundle must build with `/` (handled by the Dockerfile, §4).
