# RedLens Chatbot — Architecture Plan

## Overview

A governance chatbot for the Sky Atlas, accessible as a floating widget on every page of the RedLens app (atlas, radar, reports, home). Aware of the page the user is currently viewing.
Backed by a server-side LLM with full atlas search and graph traversal.

---

## Architecture

```
Browser (floating widget, first-party origin)
    │
    ├── page context (per message: atlas node / radar actor / report / home)
    ├── conversation history (server-side Postgres)
    └── POST /api/chat ──▶ Railway Chat Service
                                │
                                ├── OAuth (Google / GitHub) → JWT sessions
                                ├── Postgres → users + conversations + messages
                                ├── openai SDK → OpenRouter (LLM gateway)
                                └── HTTP → redlens-mcp.workers.dev/api/query
                                              │
                                              └── D1, Vectorize, graph
```

Frontend hosted on **CF Pages** (`redlens.yourdomain.com`) — free, fast CDN, Vite build already works there. Chat service on Railway at `chat.redlens.yourdomain.com`. Cookie domain `.redlens.yourdomain.com` is first-party to both. GH Pages (`anscharo.github.io/redlens`) is a temporary landing until custom domain is wired.

---

## Services

### CF Worker (`redlens-mcp`) — pure data layer, unchanged

- `/api/query` — unified multi-dimensional atlas query
- `atlas_query` MCP tool + `atlas_describe` (with live `entity_type_graph`)
- No auth, no LLM, no chat
- No CORS rules needed for Railway → Worker calls (server-to-server)

### Railway Chat Service — new Bun service

- **Runtime**: Bun (native HTTP server, no framework needed)
- **Auth**: `arctic` — Google OAuth + GitHub OAuth → JWT in signed HTTP-only cookies (first-party, SameSite=Lax)
- **Database**: Railway Postgres
  - `users` — auth identity
  - `conversations` — one per chat thread
  - `messages` — full text, per-message page context, tool calls, token usage
- **LLM gateway**: OpenRouter via an OpenAI-compatible SDK (TBD). One auth header, one cost-tracking surface. Covers Gemma, Qwen, DeepSeek, and Claude via the same wire format. SDK choice deferred until build.
- **Analytics**: SQL on Postgres (conversations + messages = full analytics, no separate tool)
- **Endpoint**: `POST /api/chat` — SSE stream, agentic loop via `atlas_query`
- **Instance**: ≥512MB to handle concurrent SSE streams

### Frontend — floating widget

- Lives in `App.tsx` shell, visible on every page (atlas, radar, reports, home)
- Captures current page context and attaches it to each outgoing message
- Loads conversation history from Railway API
- Streams responses token-by-token
- Tool-call traces hidden behind a dev/debug toggle (not default-visible)

---

## Database Schema (Railway Postgres)

```sql
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL,        -- 'google' | 'github'
  provider_id  TEXT NOT NULL,
  email        TEXT,
  name         TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(provider, provider_id)
);

CREATE TABLE conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),  -- bump on each new message; use for "recent" sort
  title               TEXT,          -- first ~60 chars of first message
  model               TEXT,
  total_input_tokens  INT DEFAULT 0,
  total_output_tokens INT DEFAULT 0,
  total_cost_usd      DECIMAL(10,6) DEFAULT 0,
  query_atlas_calls   INT DEFAULT 0
);

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  role            TEXT NOT NULL,     -- 'user' | 'assistant'
  content         TEXT NOT NULL,
  page_context    JSONB,             -- discriminated; see below
  tool_calls      JSONB,             -- [{ input, mode, count }]
  input_tokens    INT,
  output_tokens   INT,
  cost_usd        DECIMAL(10,6),
  latency_ms      INT
);
```

### `messages.page_context` shape

Discriminated union — the system prompt branches on `type` to prepend a short grounding line (~30–50 tok).

```typescript
{ type: 'atlas',  nodeId: string, nodeTitle: string, nodeDocNo: string }
{ type: 'radar',  actorSlug: string, actorLabel: string }
{ type: 'report', report: 'facilitator' | 'active-data' | 'rewards' }
{ type: 'home' }
```

---

## Models

All routed via OpenRouter. Swap with one config change (the model id string).

| Model | OpenRouter slug | Input $/M | Output $/M | Per query* | Notes |
|---|---|---|---|---|---|
| Gemma 4 26B A4B | `google/gemma-4-26b-a4b-it` | $0.06 | $0.33 | ~$0.0009 | **Default** — 256K ctx, native function calling, MoE (3.8B active) |
| Gemma 4 26B A4B (free) | `google/gemma-4-26b-a4b-it:free` | $0 | $0 | $0 | Dev / staging / benchmarking. Rate-limited (~20 req/min, daily cap) — not for prod |
| Qwen3 32B | `qwen/qwen3-32b` | $0.08 | $0.28 | ~$0.0011 | Fallback — proven reliability |
| DeepSeek V4 Flash | `deepseek/deepseek-v4-flash` | $0.11 | $0.22 | ~$0.0014 | Alternative |
| Claude Haiku 4.5 | `anthropic/claude-haiku-4.5` | $1.00 | $5.00 | ~$0.015 | Premium fallback |
| Claude Sonnet 4.6 | `anthropic/claude-sonnet-4.6` | $3.00 | $15.00 | ~$0.045 | High-stakes queries |

*~12,000 cumulative input / 550 output tokens per query (system prompt ~3K, cumulative prefills across 3 agentic turns with 2 `atlas_query` calls + answer). OpenRouter caching for non-Anthropic models is not assumed.

---

## Cost Estimate

**50 users × 50 queries/day = 75,000 queries/month**

| Component | Monthly cost |
|---|---|
| LLM (Gemma 4 26B default) | ~$70 |
| Railway (Bun ≥512MB + Postgres) | ~$10–15 |
| Cloudflare Workers | ~$5 |
| **Total** | **~$85–95/month** |

Numbers re-baseline if model benchmarking selects a different default.

---

## Auth Flow (arctic)

```
User → "Sign in with Google"
  GET  /auth/google          → redirect to Google
  GET  /auth/google/callback → arctic verifies, upsert user in Postgres
                             → set signed JWT cookie (userId, provider, exp)
  redirect → /chat

JWT cookie: stateless, HTTP-only, signed with CHAT_JWT_SECRET env var
            SameSite=Lax, first-party (frontend + API on same apex domain)
Session validation: middleware on /api/chat checks cookie on every request
```

---

## System Prompt

Built per-session by pre-fetching `entity_type_graph` from `/api/query` and branching on the current message's `page_context.type`. Mirrors the ask-atlas agent prompt (`.claude/agents/ask-atlas.md`, ~2K tok):

- Atlas doc type taxonomy
- Entity chain (live from graph — facilitator → executor → prime → docs)
- `atlas_query` tool guide with all dimensions
- History explanation section (doc type → significance, group by topic, lead with impact)
- 5-call budget
- Page-context grounding line per message (~30–50 tok)

---

## Build Order

1. Strip `/api/chat` from CF Worker — **done ✓**
2. Scaffold Railway service — Bun, routes, Postgres connection
3. Auth — arctic OAuth, JWT sessions, users table
4. `POST /api/chat` — openai SDK → OpenRouter, hand-rolled agentic loop, SSE streaming, conversation persistence, per-message `page_context`
5. Frontend widget — floating panel on all routes (atlas/radar/reports/home), page context capture per message, conversation list, dev-only tool-call trace toggle
6. Model benchmarking — Gemma 4 26B vs Qwen3 32B on representative governance questions across all four page contexts (run on `:free` slug to avoid token spend during eval)

---

## Deferred

- Rate limiting per user
- Conversation search
- Cross-device sync (currently per-browser via server sessions)
- In-browser local mode (Qwen3 0.6B) remains in `/qa` as opt-in feature
- Native Anthropic SDK integration (for prompt caching / extended thinking) — only if a Claude model becomes the default
