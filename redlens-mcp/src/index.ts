import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import askAtlasAgent from "../../.claude/agents/ask-atlas.md";

export interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORS: VectorizeIndex;
}

const VECTOR_MODEL = "@cf/baai/bge-base-en-v1.5";
const VECTOR_DIM = 768;
const RRF_K = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);

type MetaInfo = Record<string, string | null>;

// kv_meta is 4–8 rows on a PK lookup — cheaper to query each request than
// to manage cache invalidation across isolates after a sync writes new keys.
async function getMeta(db: D1Database): Promise<MetaInfo> {
  try {
    const { results } = await db.prepare("SELECT key, value FROM kv_meta").all<{ key: string; value: string }>();
    if (results.length === 0) return {};
    const out: MetaInfo = {};
    for (const r of results) out[r.key] = r.value;
    return out;
  } catch {
    return {};
  }
}

function ok(meta: MetaInfo, payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ _meta: meta, ...(payload as object) }) }],
  };
}

// Resolve a list of UUIDs/doc_nos in a single query.
async function resolveIds(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const sql = `SELECT id, doc_no FROM docs WHERE id IN (${placeholders}) OR doc_no IN (${placeholders})`;
  const { results } = await db.prepare(sql).bind(...ids, ...ids).all<{ id: string; doc_no: string }>();
  const map = new Map<string, string>();
  for (const r of results) {
    map.set(r.id, r.id);
    map.set(r.doc_no, r.id);
  }
  return map;
}

// ---- Search helpers (lexical + semantic + RRF merge) ---------------------

interface BaseRow {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parent_id: string | null;
  content: string;
  snippet?: string;
}
interface LexicalRow extends BaseRow { source: "lexical"; rank: number; score: number; }
interface SemanticRow extends BaseRow { source: "semantic"; rank: number; score: number; }
type SearchRow = (LexicalRow | SemanticRow) & { sources?: string[]; rrf_score?: number };

async function runLexical(
  db: D1Database,
  query: string,
  type: string | undefined,
  fetchK: number,
): Promise<LexicalRow[]> {
  const sql = `
    SELECT n.id, n.doc_no, n.title, n.type, n.depth, n.parent_id, n.content,
           snippet(docs_fts, 4, '<mark>', '</mark>', '…', 24) AS snippet,
           bm25(docs_fts) AS score
    FROM docs_fts JOIN docs n ON docs_fts.rowid = n.rowid
    WHERE docs_fts MATCH ?
    ${type ? "AND n.type = ?" : ""}
    ORDER BY score
    LIMIT ?
  `;
  const params: unknown[] = [query, ...(type ? [type] : []), fetchK];
  try {
    const { results } = await db.prepare(sql).bind(...params).all<{
      id: string; doc_no: string; title: string; type: string; depth: number;
      parent_id: string | null; content: string; snippet: string; score: number;
    }>();
    return results.map((r, i) => ({ ...r, source: "lexical" as const, rank: i, score: r.score }));
  } catch (err) {
    // FTS MATCH errors on bad syntax (e.g., bare punctuation) — return empty.
    console.error("lexical search failed:", err);
    return [];
  }
}

async function runSemantic(
  env: Env,
  db: D1Database,
  query: string,
  type: string | undefined,
  fetchK: number,
): Promise<SemanticRow[]> {
  // Embed the query.
  const embedRes = (await env.AI.run(VECTOR_MODEL, { text: query })) as { data: number[][] };
  const vec = embedRes.data?.[0];
  if (!vec || vec.length !== VECTOR_DIM) {
    throw new Error(`bad embedding shape: ${vec?.length}`);
  }
  // L2-normalize so cosine == dot.
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  const normalized = vec.map((x) => x / norm);

  // Post-filter `type` from D1 rather than via Vectorize metadata-filter,
  // which silently returns [] unless a metadata index has been created.
  // Over-fetch when filtering so we still get a useful number of hits.
  const overFetch = type ? Math.min(fetchK * 4, 200) : fetchK;
  const queryRes = await env.VECTORS.query(normalized, { topK: overFetch });
  const matches = queryRes.matches ?? [];
  if (matches.length === 0) return [];

  const ids = matches.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results: rows } = await db
    .prepare(`SELECT id, doc_no, title, type, depth, parent_id, content FROM docs WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<BaseRow>();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: SemanticRow[] = [];
  let kept = 0;
  for (let i = 0; i < matches.length && kept < fetchK; i++) {
    const row = byId.get(matches[i].id);
    if (!row) continue;
    if (type && row.type !== type) continue;
    out.push({ ...row, source: "semantic", rank: kept, score: matches[i].score });
    kept++;
  }
  return out;
}

function rrfMerge(lex: LexicalRow[], sem: SemanticRow[]): SearchRow[] {
  const acc = new Map<string, SearchRow>();
  const bump = (row: LexicalRow | SemanticRow) => {
    const prev = acc.get(row.id);
    const inc = 1 / (RRF_K + row.rank + 1);
    if (prev) {
      prev.rrf_score = (prev.rrf_score ?? 0) + inc;
      if (!prev.sources?.includes(row.source)) {
        prev.sources = [...(prev.sources ?? []), row.source];
      }
    } else {
      acc.set(row.id, { ...row, rrf_score: inc, sources: [row.source] });
    }
  };
  for (const r of lex) bump(r);
  for (const r of sem) bump(r);
  return [...acc.values()].sort((a, b) => (b.rrf_score ?? 0) - (a.rrf_score ?? 0));
}

// One recursive query: ancestor chain (parent → ... → root) for a set of seed UUIDs.
type Ancestor = { id: string; doc_no: string; title: string; type: string; depth: number };
async function getAncestorChains(db: D1Database, seedUuids: string[]): Promise<Map<string, Ancestor[]>> {
  if (seedUuids.length === 0) return new Map();
  const placeholders = seedUuids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`
      WITH RECURSIVE chain(seed, id, hop) AS (
        SELECT id, parent_id, 1 FROM docs WHERE id IN (${placeholders})
        UNION ALL
        SELECT c.seed, d.parent_id, c.hop + 1
        FROM docs d JOIN chain c ON d.id = c.id
        WHERE d.parent_id IS NOT NULL
      )
      SELECT c.seed, c.hop, n.id, n.doc_no, n.title, n.type, n.depth
      FROM chain c JOIN docs n ON n.id = c.id
      ORDER BY c.seed, c.hop
    `)
    .bind(...seedUuids)
    .all<Ancestor & { seed: string; hop: number }>();

  const out = new Map<string, Ancestor[]>();
  for (const seed of seedUuids) out.set(seed, []);
  for (const r of results) {
    out.get(r.seed)!.push({ id: r.id, doc_no: r.doc_no, title: r.title, type: r.type, depth: r.depth });
  }
  return out;
}

// Where the deployed RedLens app serves the per-node history JSON.
// v0: hardcoded GitHub Pages URL. Swap to an env var when we have a stable need.
const HISTORY_BASE_URL = "https://anscharo.github.io/redlens/history";


// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------

function createMcpServer(env: Env): McpServer {
  const db = env.DB;
  const server = new McpServer({ name: "redlens-atlas", version: "1.3.0" });

  // ---- atlas_describe ----
  server.tool(
    "atlas_describe",
    "Self-describing schema. Returns live doc-type taxonomy with counts, edge-type vocabulary with counts, entity types and slugs, Type Specifications, and atlas/vectors commit pins. Call once at session start to discover what's available without relying on hardcoded lists that drift as the atlas evolves.",
    {},
    async () => {
      const meta = await getMeta(db);
      const [docTypes, edgeTypes, entityTypes, entitySlugs, typeSpecs, docCount] = await Promise.all([
        db.prepare(`SELECT type, COUNT(*) AS count FROM docs GROUP BY type ORDER BY count DESC`)
          .all<{ type: string; count: number }>(),
        db.prepare(`SELECT edge_type, COUNT(*) AS count FROM edges GROUP BY edge_type ORDER BY count DESC`)
          .all<{ edge_type: string; count: number }>(),
        db.prepare(`SELECT entity_type, subtype, COUNT(*) AS count FROM entities WHERE is_active = 1
                    GROUP BY entity_type, subtype ORDER BY entity_type, subtype`)
          .all<{ entity_type: string; subtype: string | null; count: number }>(),
        db.prepare(`SELECT slug FROM entities WHERE is_active = 1 ORDER BY slug`)
          .all<{ slug: string }>(),
        db.prepare(`SELECT id, doc_no, title FROM docs WHERE type = 'Type Specification'
                    ORDER BY doc_no LIMIT 200`)
          .all<{ id: string; doc_no: string; title: string }>(),
        db.prepare(`SELECT COUNT(*) AS count FROM docs`).first<{ count: number }>(),
      ]);
      return ok(meta, {
        doc_count: docCount?.count ?? 0,
        doc_types: docTypes.results,
        edge_types: edgeTypes.results,
        entity_types: entityTypes.results,
        entity_slugs: entitySlugs.results.map((r) => r.slug),
        type_specifications: typeSpecs.results,
      });
    },
  );

  // ---- atlas_search ----
  server.tool(
    "atlas_search",
    'Search the Sky Atlas. mode="lexical" uses FTS5 (good for exact terms, IDs, addresses). mode="semantic" uses bge-base-en embeddings (good for paraphrase / concept queries). mode="hybrid" (default) merges both via reciprocal rank fusion. Quoted phrases ("...") are post-filtered to require exact substring match in title or content.',
    {
      query: z.string().describe('Query. Quote phrases for exact-substring match: foo "USDS PSM" bar'),
      k: z.number().int().min(1).max(50).default(10),
      type: z.string().optional().describe("Optional Atlas document type filter."),
      mode: z.enum(["lexical", "semantic", "hybrid"]).default("hybrid"),
    },
    async ({ query, k, type, mode }) => {
      const meta = await getMeta(db);
      const phrases = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const fetchK = mode === "lexical" && phrases.length === 0 ? k : Math.min(k * 4, 200);

      const [lex, sem] = await Promise.all([
        mode === "semantic"
          ? Promise.resolve<LexicalRow[]>([])
          : runLexical(db, query, type, fetchK),
        mode === "lexical"
          ? Promise.resolve<SemanticRow[]>([])
          : runSemantic(env, db, query, type, fetchK).catch((err) => {
              console.error("semantic search failed:", err);
              return [] as SemanticRow[];
            }),
      ]);

      let merged: SearchRow[];
      if (mode === "lexical") merged = lex;
      else if (mode === "semantic") merged = sem;
      else merged = rrfMerge(lex, sem);

      const filtered = phrases.length === 0
        ? merged
        : merged.filter((r) => {
            const hay = `${r.title}\n${r.content}`.toLowerCase();
            return phrases.every((p) => hay.includes(p.toLowerCase()));
          });
      const trimmed = filtered.slice(0, k).map(({ content: _c, ...rest }) => rest);
      return ok(meta, {
        count: trimmed.length,
        mode,
        phrase_filter: phrases,
        results: trimmed,
      });
    },
  );

  // ---- atlas_get (single or bulk) ----
  server.tool(
    "atlas_get",
    "Fetch one or many Atlas nodes by UUID or doc_no. Each result includes the full ancestor chain (parent → root). Pass a string for one node or an array for bulk.",
    {
      id: z.union([z.string(), z.array(z.string()).min(1).max(100)]).describe("UUID or doc_no, or an array of them."),
    },
    async ({ id }) => {
      const meta = await getMeta(db);
      const inputs = Array.isArray(id) ? id : [id];
      const isBulk = Array.isArray(id);

      const resolved = await resolveIds(db, inputs);
      const uuids = [...new Set(inputs.map((q) => resolved.get(q)).filter((x): x is string => !!x))];
      if (uuids.length === 0) return ok(meta, isBulk ? { results: [] } : { error: "Not found" });

      const placeholders = uuids.map(() => "?").join(",");
      const { results: rows } = await db
        .prepare(`SELECT * FROM docs WHERE id IN (${placeholders})`)
        .bind(...uuids)
        .all<{ id: string; doc_no: string; title: string; type: string; depth: number;
              parent_id: string | null; content: string; ord: number }>();
      const ancestors = await getAncestorChains(db, uuids);

      const enriched = rows.map((r) => ({ ...r, ancestors: ancestors.get(r.id) ?? [] }));

      if (!isBulk) {
        const found = enriched.find((r) => inputs.includes(r.id) || inputs.includes(r.doc_no));
        return ok(meta, found ?? { error: "Not found" });
      }

      // Preserve input order; mark misses.
      const byId = new Map(enriched.map((r) => [r.id, r]));
      const ordered = inputs.map((q) => {
        const uuid = resolved.get(q);
        return uuid ? (byId.get(uuid) ?? { query: q, error: "Not found" }) : { query: q, error: "Not found" };
      });
      return ok(meta, { count: ordered.length, results: ordered });
    },
  );

  // ---- atlas_neighbors ----
  server.tool(
    "atlas_neighbors",
    "Return the hierarchical context around a node: parent, N siblings above/below, and direct children.",
    {
      id: z.string().describe("Node UUID or doc number."),
      window: z.number().int().min(0).max(32).default(8).describe("Siblings and children to include."),
    },
    async ({ id, window }) => {
      const meta = await getMeta(db);
      const col = isUuid(id) ? "id" : "doc_no";
      const target = await db.prepare(`SELECT * FROM docs WHERE ${col} = ? LIMIT 1`).bind(id).first();
      if (!target) return ok(meta, { error: "Not found" });

      const [parent, siblings, children] = await Promise.all([
        target.parent_id
          ? db.prepare("SELECT id,doc_no,title,type,depth FROM docs WHERE id = ?").bind(target.parent_id).first()
          : Promise.resolve(null),
        db.prepare(
          `SELECT id,doc_no,title,type,depth FROM docs WHERE parent_id = ? AND id != ? ORDER BY ord LIMIT ?`,
        ).bind(target.parent_id ?? null, target.id, window * 2).all(),
        db.prepare(
          `SELECT id,doc_no,title,type,depth FROM docs WHERE parent_id = ? ORDER BY ord LIMIT ?`,
        ).bind(target.id, window).all(),
      ]);

      return ok(meta, { target, parent, siblings: siblings.results, children: children.results });
    },
  );

  // ---- atlas_traverse ----
  server.tool(
    "atlas_traverse",
    "Traverse the graph from a node, following typed edges up to N hops. Use to find all related nodes.",
    {
      id: z.string().describe("Starting node UUID or doc number."),
      edge_type: z.string().optional().describe("Edge type filter (e.g. 'cites', 'responsible_for')."),
      hops: z.number().int().min(1).max(4).default(2).describe("Maximum traversal depth."),
      direction: z.enum(["out", "in", "both"]).default("out"),
    },
    async ({ id, edge_type, hops, direction }) => {
      const meta = await getMeta(db);
      const startNode = await db
        .prepare(`SELECT id FROM docs WHERE ${isUuid(id) ? "id" : "doc_no"} = ? LIMIT 1`)
        .bind(id)
        .first<{ id: string }>();
      if (!startNode) return ok(meta, { error: "Not found" });

      const typeFilter = edge_type ? "AND e.edge_type = ?" : "";
      const directionClause =
        direction === "out"
          ? `e.from_id = r.id ${typeFilter}`
          : direction === "in"
            ? `e.to_id = r.id ${typeFilter}`
            : `(e.from_id = r.id OR e.to_id = r.id) ${typeFilter}`;

      const bindParams = edge_type ? [startNode.id, hops, edge_type] : [startNode.id, hops];

      const { results } = await db
        .prepare(`
        WITH RECURSIVE reachable(id, depth) AS (
          SELECT ?, 0
          UNION
          SELECT CASE WHEN e.from_id = r.id THEN e.to_id ELSE e.from_id END, r.depth + 1
          FROM edges e JOIN reachable r ON ${directionClause}
          WHERE r.depth < ?
        )
        SELECT DISTINCT n.id, n.doc_no, n.title, n.type, r.depth
        FROM reachable r
        JOIN docs n ON r.id = n.id
        WHERE n.id != ?
        ORDER BY r.depth, n.doc_no
      `)
        .bind(...bindParams, startNode.id)
        .all();

      return ok(meta, { count: results.length, results });
    },
  );

  // ---- atlas_entity ----
  server.tool(
    "atlas_entity",
    "Get all Atlas sections related to a named entity (agent, role, or actor). Returns nodes, inbound references, and Active Data sections they control.",
    {
      name: z.string().describe("Entity name (e.g. 'spark', 'operational-facilitator', 'core-govops')."),
    },
    async ({ name }) => {
      const meta = await getMeta(db);
      const entity = await db.prepare(`SELECT id, defining_doc_id FROM entities WHERE slug = ? LIMIT 1`)
        .bind(name)
        .first<{ id: string; defining_doc_id: string | null }>();
      const entityId = entity?.id ?? null;
      const rootUuid = entity?.defining_doc_id ?? agentRootUuid(name);

      const [byEdge, byDocNo, responsibilities, activeData] = await Promise.all([
        entityId
          ? db.prepare(`SELECT DISTINCT n.id,n.doc_no,n.title,n.type,n.depth
                        FROM edges e JOIN docs n ON e.to_id=n.id
                        WHERE e.from_id=? LIMIT 100`).bind(entityId).all()
          : Promise.resolve({ results: [] }),
        rootUuid
          ? db.prepare(`WITH RECURSIVE tree(id) AS (
                          SELECT ? UNION ALL
                          SELECT d.id FROM docs d JOIN tree t ON d.parent_id = t.id
                        )
                        SELECT d.id,d.doc_no,d.title,d.type,d.depth
                        FROM docs d JOIN tree t ON d.id = t.id
                        ORDER BY d.doc_no LIMIT 200`).bind(rootUuid).all()
          : Promise.resolve({ results: [] }),
        entityId
          ? db.prepare(`SELECT n.id,n.doc_no,n.title,n.type FROM edges e
                        JOIN docs n ON e.to_id=n.id
                        WHERE e.from_id=? AND e.edge_type='responsible_for'
                        ORDER BY n.doc_no`).bind(entityId).all()
          : Promise.resolve({ results: [] }),
        entityId
          ? db.prepare(`SELECT n.id,n.doc_no,n.title,e.edge_type FROM edges e
                        JOIN docs n ON e.to_id=n.id
                        WHERE e.from_id=? AND n.type IN ('Active Data Controller','Active Data')
                        ORDER BY n.doc_no`).bind(entityId).all()
          : Promise.resolve({ results: [] }),
      ]);

      return ok(meta, {
        entity: name,
        entityId,
        nodes: [...byEdge.results, ...byDocNo.results],
        responsibilities: responsibilities.results,
        activeData: activeData.results,
      });
    },
  );

  // ---- atlas_filter (with structural filters) ----
  server.tool(
    "atlas_filter",
    "Filter Atlas documents by structural attributes. Compose any of: type, entity slug (restricts to entity's artifact subtree), ancestor_id (recursive descendants), doc_no_pattern (SQL LIKE, e.g. '%.0.4.%' for Action Tenets, '%.varX' for variations), depth_min/max.",
    {
      type: z.string().optional().describe("Atlas document type (e.g. 'Active Data', 'Core', 'Action Tenet')."),
      entity: z.string().optional().describe("Entity slug — restricts to the entity's defining_doc subtree."),
      ancestor_id: z.string().optional().describe("UUID or doc_no — restricts to recursive descendants of this node."),
      doc_no_pattern: z.string().optional().describe("SQL LIKE pattern over doc_no (use % wildcards)."),
      depth_min: z.number().int().min(0).max(20).optional(),
      depth_max: z.number().int().min(0).max(20).optional(),
      limit: z.number().int().min(1).max(500).default(200),
      include_content: z.boolean().default(true).describe("Include full content in each result row. Set false for lighter responses when listing many rows."),
    },
    async ({ type, entity, ancestor_id, doc_no_pattern, depth_min, depth_max, limit, include_content }) => {
      const meta = await getMeta(db);
      if (!type && !entity && !ancestor_id && !doc_no_pattern && depth_min == null && depth_max == null) {
        return ok(meta, { error: "Provide at least one filter: type, entity, ancestor_id, doc_no_pattern, or depth_min/max" });
      }

      // Resolve subtree root UUID, if any.
      let rootUuid: string | null = null;
      if (entity) {
        const ent = await db.prepare(`SELECT defining_doc_id FROM entities WHERE slug = ? LIMIT 1`)
          .bind(entity.toLowerCase())
          .first<{ defining_doc_id: string | null }>();
        if (!ent?.defining_doc_id) return ok(meta, { error: `Entity '${entity}' not found` });
        rootUuid = ent.defining_doc_id;
      }
      if (ancestor_id) {
        const node = await db
          .prepare(`SELECT id FROM docs WHERE ${isUuid(ancestor_id) ? "id" : "doc_no"} = ? LIMIT 1`)
          .bind(ancestor_id)
          .first<{ id: string }>();
        if (!node) return ok(meta, { error: `ancestor_id '${ancestor_id}' not found` });
        // entity + ancestor_id both set → ancestor_id wins (more specific)
        rootUuid = node.id;
      }

      const cols = `d.id, d.doc_no, d.title, d.type, d.depth, d.parent_id${include_content ? ", d.content" : ""}`;
      const where: string[] = [];
      const params: unknown[] = [];
      if (type) { where.push("d.type = ?"); params.push(type); }
      if (doc_no_pattern) { where.push("d.doc_no LIKE ?"); params.push(doc_no_pattern); }
      if (depth_min != null) { where.push("d.depth >= ?"); params.push(depth_min); }
      if (depth_max != null) { where.push("d.depth <= ?"); params.push(depth_max); }

      let sql: string;
      if (rootUuid) {
        sql = `
          WITH RECURSIVE tree(id) AS (
            SELECT ?
            UNION ALL
            SELECT d.id FROM docs d JOIN tree t ON d.parent_id = t.id
          )
          SELECT ${cols}
          FROM docs d JOIN tree t ON d.id = t.id
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
          ORDER BY d.doc_no
          LIMIT ?
        `;
        params.unshift(rootUuid);
        params.push(limit);
      } else {
        sql = `
          SELECT ${cols}
          FROM docs d
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
          ORDER BY d.doc_no
          LIMIT ?
        `;
        params.push(limit);
      }

      const { results } = await db.prepare(sql).bind(...params).all();
      return ok(meta, { count: results.length, results });
    },
  );

  // ---- atlas_get_address ----
  server.tool(
    "atlas_get_address",
    "Look up an on-chain address. Returns merged atlas + chain metadata (label, chainlog id, etherscan name, roles, aliases, expected tokens, chain_state snapshot), the linked entity, and the doc edges that reference the address.",
    {
      address: z.string().describe("0x… (EVM) or base58 (Solana)."),
      chain: z.string().optional().describe("Optional chain filter (e.g. 'ethereum', 'solana')."),
    },
    async ({ address, chain }) => {
      const meta = await getMeta(db);
      const addr = address.toLowerCase();

      const addrSql = `
        SELECT a.address, a.chain, a.label, a.chainlog_id, a.etherscan_name,
               a.is_contract, a.is_proxy, a.implementation,
               a.roles AS roles_json, a.aliases AS aliases_json,
               a.expected_tokens AS expected_tokens_json,
               a.chain_state AS chain_state_json, a.state_block, a.entity_id,
               e.slug AS entity_slug, e.name AS entity_name,
               e.entity_type AS entity_type, e.subtype AS entity_subtype,
               e.defining_doc_id AS entity_defining_doc_id
        FROM addresses a
        LEFT JOIN entities e ON a.entity_id = e.id
        WHERE a.address = ? ${chain ? "AND a.chain = ?" : ""}
      `;
      const { results: addrRows } = await db
        .prepare(addrSql)
        .bind(...(chain ? [addr, chain] : [addr]))
        .all();
      if (addrRows.length === 0) return ok(meta, { error: "Address not found", address: addr });

      // Edges where this address is the target.
      const { results: edges } = await db
        .prepare(`
          SELECT e.edge_type, e.source_doc_nos, e.meta AS edge_meta,
                 n.id AS doc_id, n.doc_no, n.title, n.type
          FROM edges e
          LEFT JOIN docs n ON e.from_id = n.id AND e.from_type = 'doc'
          WHERE e.to_id = ? AND e.to_type = 'address'
          ORDER BY n.doc_no
          LIMIT 200
        `)
        .bind(addr)
        .all();

      // Parse JSON columns for ergonomics; drop the raw `_json` strings.
      const records = addrRows.map((r: any) => {
        const { roles_json, aliases_json, expected_tokens_json, chain_state_json, ...rest } = r;
        return {
          ...rest,
          roles: safeJson(roles_json, []),
          aliases: safeJson(aliases_json, []),
          expected_tokens: safeJson(expected_tokens_json, []),
          chain_state: safeJson(chain_state_json, null),
        };
      });

      return ok(meta, { address: addr, records, edges });
    },
  );

  // ---- atlas_entity_params ----
  server.tool(
    "atlas_entity_params",
    "Return the immediate Core children of a doc as a parameter map. Useful for any ICD (operational Instances and in-progress Invocations alike) whose params are encoded as child Cores. Pass either a doc id (UUID/doc_no) or an entity slug — for an entity, returns params for every ICD doc under its defining subtree.",
    {
      id: z.string().optional().describe("Doc UUID or doc_no (typically an instance doc)."),
      entity: z.string().optional().describe("Entity slug — fetch params for all instance docs under entity."),
      type_hint: z.string().optional().describe("Filter instance docs by type (e.g. 'Reward', 'Primitive Instance'). Only applies with `entity`."),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async ({ id, entity, type_hint, limit }) => {
      const meta = await getMeta(db);
      if (!id && !entity) return ok(meta, { error: "Provide id or entity" });

      // Resolve which instance docs to read params for.
      let instanceIds: string[] = [];
      if (id) {
        const node = await db.prepare(`SELECT id FROM docs WHERE ${isUuid(id) ? "id" : "doc_no"} = ? LIMIT 1`)
          .bind(id).first<{ id: string }>();
        if (!node) return ok(meta, { error: "Not found" });
        instanceIds = [node.id];
      } else if (entity) {
        const ent = await db.prepare(`SELECT defining_doc_id FROM entities WHERE slug = ? LIMIT 1`)
          .bind(entity.toLowerCase()).first<{ defining_doc_id: string | null }>();
        if (!ent?.defining_doc_id) return ok(meta, { error: `Entity '${entity}' not found` });
        const sql = `
          WITH RECURSIVE tree(id) AS (
            SELECT ?
            UNION ALL
            SELECT d.id FROM docs d JOIN tree t ON d.parent_id = t.id
          )
          SELECT d.id FROM docs d JOIN tree t ON d.id = t.id
          ${type_hint ? "WHERE d.type = ?" : ""}
          LIMIT ?
        `;
        const params: unknown[] = type_hint ? [ent.defining_doc_id, type_hint, limit] : [ent.defining_doc_id, limit];
        const { results } = await db.prepare(sql).bind(...params).all<{ id: string }>();
        instanceIds = results.map((r) => r.id);
      }
      if (instanceIds.length === 0) return ok(meta, { instances: [] });

      // For each instance, fetch the instance row + its immediate Core children.
      const placeholders = instanceIds.map(() => "?").join(",");
      const [{ results: instRows }, { results: childRows }] = await Promise.all([
        db.prepare(`SELECT id, doc_no, title, type FROM docs WHERE id IN (${placeholders})`)
          .bind(...instanceIds).all<{ id: string; doc_no: string; title: string; type: string }>(),
        db.prepare(`
          SELECT id, doc_no, title, type, content, parent_id
          FROM docs WHERE parent_id IN (${placeholders})
          ORDER BY ord
        `).bind(...instanceIds).all<{ id: string; doc_no: string; title: string; type: string; content: string; parent_id: string }>(),
      ]);

      const childrenByParent = new Map<string, typeof childRows>();
      for (const c of childRows) {
        if (!childrenByParent.has(c.parent_id)) childrenByParent.set(c.parent_id, []);
        childrenByParent.get(c.parent_id)!.push(c);
      }

      const instances = instRows.map((inst) => ({
        ...inst,
        params: (childrenByParent.get(inst.id) ?? []).map((c) => ({
          id: c.id, doc_no: c.doc_no, name: c.title, type: c.type, value: c.content,
        })),
      }));
      return ok(meta, { count: instances.length, instances });
    },
  );

  // atlas_history — change log for one doc, with PR rationale
  server.tool(
    "atlas_history",
    "Why was this changed? Returns the git-log of changes for one Atlas doc (UUID or doc_no), newest first, each with PR title/author/url and the matched summary/description from the PR body. Filter by date range, PR number, or change type. Set with_diff=true to also fetch line+word diffs from the deployed RedLens site.",
    {
      id: z.string().describe("Doc UUID or doc_no (e.g. 'A.1.2.3')."),
      since: z.string().optional().describe("ISO date (YYYY-MM-DD) — only changes on or after this date."),
      until: z.string().optional().describe("ISO date (YYYY-MM-DD) — only changes on or before this date."),
      pr: z.number().int().optional().describe("Filter to a single PR number."),
      change_type: z.enum(["added", "modified", "removed", "moved"]).optional(),
      with_diff: z.boolean().default(false).describe("If true, fetch line+word diffs from the deployed RedLens history JSON and inline them into matching events."),
    },
    async ({ id, since, until, pr, change_type, with_diff }) => {
      // Resolve id to UUID — history is keyed by UUID
      const doc = await db
        .prepare(`SELECT id, doc_no, title, type FROM docs WHERE ${UUID_RE.test(id) ? "id" : "doc_no"} = ? LIMIT 1`)
        .bind(id)
        .first<{ id: string; doc_no: string; title: string; type: string }>();
      if (!doc) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }] };
      }

      const where = ["doc_id = ?"];
      const params: unknown[] = [doc.id];
      if (since) { where.push("date >= ?"); params.push(since); }
      if (until) { where.push("date <= ?"); params.push(until); }
      if (pr != null) { where.push("pr_number = ?"); params.push(pr); }
      if (change_type) { where.push("change_type = ?"); params.push(change_type); }

      const { results } = await db
        .prepare(`SELECT date, commit_hash, change_type, pr_number, pr_title, pr_author, pr_url,
                         summary, description, moved_from, moved_to
                  FROM node_history WHERE ${where.join(" AND ")}
                  ORDER BY date DESC, id DESC`)
        .bind(...params)
        .all<{
          date: string; commit_hash: string; change_type: string;
          pr_number: number | null; pr_title: string | null; pr_author: string | null; pr_url: string | null;
          summary: string | null; description: string | null;
          moved_from: string | null; moved_to: string | null;
        }>();

      let events: Array<Record<string, unknown>> = results;

      if (with_diff && results.length > 0) {
        try {
          const res = await fetch(`${HISTORY_BASE_URL}/${doc.id}.json`, { cf: { cacheTtl: 300 } } as RequestInit);
          if (res.ok) {
            const raw = (await res.json()) as Array<{ commitHash: string; diff?: unknown }>;
            const diffByCommit = new Map(raw.map((e) => [e.commitHash, e.diff]));
            events = results.map((e) => ({ ...e, diff: diffByCommit.get(e.commit_hash) ?? null }));
          }
        } catch (err) {
          console.error("atlas_history with_diff fetch failed:", err);
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ doc, count: events.length, events }) }],
      };
    },
  );

  // atlas_recent_changes — global feed of recent changes, type-filterable
  server.tool(
    "atlas_recent_changes",
    "What changed recently? Returns the most recent change events across the whole atlas, optionally filtered by doc type (e.g. 'Active Data') or change type. Defaults to the last 30 days.",
    {
      since: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to 30 days ago."),
      until: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
      type: z.string().optional().describe("Atlas doc type filter (e.g. 'Active Data', 'Core', 'Annotation')."),
      change_type: z.enum(["added", "modified", "removed", "moved"]).optional(),
      k: z.number().int().min(1).max(200).default(50),
    },
    async ({ since, until, type, change_type, k }) => {
      const defaultSince = (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 30);
        return d.toISOString().slice(0, 10);
      })();

      const where = ["h.date >= ?"];
      const params: unknown[] = [since ?? defaultSince];
      if (until) { where.push("h.date <= ?"); params.push(until); }
      if (type) { where.push("n.type = ?"); params.push(type); }
      if (change_type) { where.push("h.change_type = ?"); params.push(change_type); }

      const { results } = await db
        .prepare(`SELECT h.date, h.commit_hash, h.change_type,
                         h.pr_number, h.pr_title, h.pr_author, h.pr_url,
                         h.summary, h.description,
                         n.id AS doc_id, n.doc_no, n.title, n.type
                  FROM node_history h
                  JOIN docs n ON n.id = h.doc_id
                  WHERE ${where.join(" AND ")}
                  ORDER BY h.date DESC, h.id DESC
                  LIMIT ?`)
        .bind(...params, k)
        .all();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            since: since ?? defaultSince,
            until: until ?? null,
            type: type ?? null,
            change_type: change_type ?? null,
            count: results.length,
            events: results,
          }),
        }],
      };
    },
  );

  // atlas_pr — every doc touched by a single PR
  server.tool(
    "atlas_pr",
    "What did PR #N touch? Returns every doc affected by a single GitHub PR against next-gen-atlas, with the matched per-doc summary/description from the PR body.",
    {
      pr_number: z.number().int().describe("GitHub PR number on sky-ecosystem/next-gen-atlas."),
    },
    async ({ pr_number }) => {
      const { results } = await db
        .prepare(`SELECT h.date, h.commit_hash, h.change_type,
                         h.pr_title, h.pr_author, h.pr_url,
                         h.summary, h.description,
                         h.moved_from, h.moved_to,
                         n.id AS doc_id, n.doc_no, n.title, n.type
                  FROM node_history h
                  LEFT JOIN docs n ON n.id = h.doc_id
                  WHERE h.pr_number = ?
                  ORDER BY n.doc_no, h.change_type`)
        .bind(pr_number)
        .all<{ pr_title: string | null; pr_author: string | null; pr_url: string | null }>();

      const first = results[0];
      const pr = first
        ? { number: pr_number, title: first.pr_title, author: first.pr_author, url: first.pr_url }
        : { number: pr_number, title: null, author: null, url: null };

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ pr, count: results.length, events: results }),
        }],
      };
    },
  );

  return server;
}

function safeJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

// Map entity slug to Atlas artifact root UUID for subtree fallback queries.
// UUIDs are stable; doc_nos change on atlas renumbering.
function agentRootUuid(name: string): string {
  const map: Record<string, string> = {
    spark:           "dee2f5a4-279a-488c-9a9d-9583e3216fbf", // A.6.1.1.1
    grove:           "727b0de6-095b-485e-bf9c-02108a364480", // A.6.1.1.2
    keel:            "bc6aed17-2969-4d04-9af6-c7bf3e4497e6", // A.6.1.1.3
    skybase:         "c88439b5-f456-4e51-8825-42e0ba83546f", // A.6.1.1.4
    obex:            "f558e673-cbab-4696-8ca1-3af9b90fe5d4", // A.6.1.1.5
    pattern:         "dc083d10-74bc-43b6-ab2f-c91efce76e84", // A.6.1.1.6
    "launch-agent-6": "eba0dcc7-e135-496f-b866-342deeb91dc4", // A.6.1.1.7
    "launch-agent-7": "d0d77316-0b08-447c-b75a-ae7926b07019", // A.6.1.1.8
  };
  return map[name.toLowerCase()] ?? "";
}

// ---------------------------------------------------------------------------
// Hono app — MCP + REST
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

// Landing page
app.get("/", (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RedLens Atlas MCP</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 60px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #555; margin-bottom: 32px; }
    .subtitle a { color: #a63228; }
    h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: .05em; color: #888; margin: 28px 0 8px; }
    pre { background: #f4f1ec; border-radius: 6px; padding: 16px; overflow-x: auto; font-size: 0.85rem; }
    code { font-family: "Source Code Pro", monospace; }
    .endpoint { font-size: 0.9rem; color: #444; }
    .endpoint code { background: #f4f1ec; padding: 2px 6px; border-radius: 3px; }
    footer { margin-top: 48px; font-size: 0.8rem; color: #aaa; }
    footer a { color: #aaa; }
  </style>
</head>
<body>
  <h1>RedLens Atlas MCP Server</h1>
  <p class="subtitle">
    Query the <a href="https://github.com/sky-ecosystem/next-gen-atlas" target="_blank">Sky Atlas</a> —
    the governance &amp; operational constitution of the
    <a href="https://sky.money" target="_blank">Sky protocol</a> —
    using natural-language and structured search directly from your AI assistant.
  </p>

  <h2>What is this?</h2>
  <p>
    An <a href="https://modelcontextprotocol.io" target="_blank">MCP (Model Context Protocol)</a> server
    that gives AI tools (Claude, Cursor, etc.) full-text and graph search over the
    9,825-node Sky Atlas document. Ask your assistant things like
    <em>"What does the Sky Atlas say about USDS stability fees?"</em> or
    <em>"Show me the Active Data sections controlled by Spark."</em>
  </p>

  <h2>Ask the Atlas (Claude Code agent)</h2>
  <p>
    Install the <code>ask-atlas</code> subagent into your project — a Sky Atlas governance specialist
    that retrieves and cites atlas documents to answer questions about rules, roles, primitives, and entities.
  </p>
  <pre><code>mkdir -p .claude/agents && curl -fsSL https://redlens-mcp.anscharo.workers.dev/install/ask-atlas -o .claude/agents/ask-atlas.md</code></pre>
  <p>Then connect the MCP server (see below), reload Claude Code, and invoke with <code>@ask-atlas</code>:</p>
  <pre><code>@ask-atlas What does the Atlas say about USDS stability fees?
@ask-atlas Show me the Active Data sections controlled by Spark
@ask-atlas learn: [paste content] (source: forum post by X)</code></pre>

  <h2>Add to Claude Code</h2>
  <p>Add the following to your project's <code>.mcp.json</code>:</p>
  <pre><code>{
  "mcpServers": {
    "redlens": {
      "type": "http",
      "url": "https://redlens-mcp.anscharo.workers.dev/mcp"
    }
  }
}</code></pre>

  <h2>Add to Claude Desktop</h2>
  <p>Add the following to your <code>claude_desktop_config.json</code>:</p>
  <pre><code>{
  "mcpServers": {
    "redlens": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://redlens-mcp.anscharo.workers.dev/mcp"
      ]
    }
  }
}</code></pre>

  <h2>Add to Cursor / other MCP clients</h2>
  <p>Point your client at the streamable HTTP endpoint:</p>
  <pre><code>https://redlens-mcp.anscharo.workers.dev/mcp</code></pre>

  <h2>Run locally (development)</h2>
  <p>Clone the repo, then in <code>redlens-mcp/</code>:</p>
  <pre><code>pnpm dev   # starts wrangler dev on http://localhost:8787</code></pre>
  <p>Then add to <code>.mcp.json</code>:</p>
  <pre><code>{
  "mcpServers": {
    "redlens-local": {
      "type": "http",
      "url": "http://localhost:8787/mcp"
    }
  }
}</code></pre>

  <h2>REST API (no client needed)</h2>
  <p class="endpoint">
    <code>GET /api/search?q=…&amp;k=10</code> — full-text search<br/>
    <code>GET /api/node/:id</code> — fetch node by UUID or doc number (e.g. <code>A.1.2.3</code>)<br/>
    <code>GET /api/entity/:name</code> — all sections for a named entity<br/>
    <code>GET /api/address/:addr</code> — address lookup with linked entity + edges<br/>
    <code>GET /api/traverse/:id?hops=2</code> — graph traversal from a node<br/>
    <code>GET /api/meta</code> — current atlas/redlens commit + generation timestamp
  </p>

  <h2>Available MCP tools</h2>
  <p class="endpoint">
    <code>atlas_describe</code> — live schema: doc types, edge types, entity slugs, type specs, atlas/vectors pins<br/>
    <code>atlas_search</code> — FTS5 full-text search; quoted phrases match as exact substrings<br/>
    <code>atlas_get</code> — single or bulk fetch (array of ids); each result includes ancestor chain<br/>
    <code>atlas_neighbors</code> — parent / siblings / children of a node<br/>
    <code>atlas_traverse</code> — multi-hop typed-edge traversal<br/>
    <code>atlas_entity</code> — aggregate view of a named entity (agent, role, actor)<br/>
    <code>atlas_filter</code> — structural filter: type / entity / ancestor / doc_no_pattern / depth<br/>
    <code>atlas_get_address</code> — on-chain address lookup with merged atlas + chain metadata<br/>
    <code>atlas_entity_params</code> — child-Core "params" of an instance doc (Reward, Primitive Instance, …)
    <code>atlas_search</code> · <code>atlas_get</code> · <code>atlas_neighbors</code> ·
    <code>atlas_traverse</code> · <code>atlas_entity</code> ·
    <code>atlas_history</code> · <code>atlas_recent_changes</code> · <code>atlas_pr</code>
  </p>
  <p>Every tool response is wrapped with <code>_meta: { atlasCommit, redlensCommit, generatedAt }</code> so callers can verify which atlas snapshot produced the answer.</p>

  <footer>
    <a href="https://github.com/anscharo/redlens" target="_blank">github.com/anscharo/redlens</a>
  </footer>
</body>
</html>`;
  return c.html(html);
});

// Install: serve the ask-atlas agent definition
app.get("/install/ask-atlas", (c) =>
  c.text(askAtlasAgent, 200, { "Content-Type": "text/plain; charset=utf-8" }),
);

// MCP endpoint (streamable HTTP transport — POST only; SSE not supported in stateless workers)
app.get("/mcp", (c) => c.text("Method Not Allowed", 405));
app.post("/mcp", async (c) => {
  const server = createMcpServer(c.env);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

// REST: meta
app.get("/api/meta", async (c) => c.json(await getMeta(c.env.DB)));

// REST: search
app.get("/api/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const k = Math.min(parseInt(c.req.query("k") ?? "10"), 50);
  const type = c.req.query("type");
  if (!q) return c.json({ error: "q required" }, 400);

  let sql = `SELECT n.id,n.doc_no,n.title,n.type,n.depth,
             snippet(docs_fts,4,'<mark>','</mark>','…',24) AS snippet,
             bm25(docs_fts) AS score
             FROM docs_fts JOIN docs n ON docs_fts.rowid=n.rowid
             WHERE docs_fts MATCH ?
             ${type ? "AND n.type=?" : ""}
             ORDER BY score LIMIT ?`;
  const params: unknown[] = [q, ...(type ? [type] : []), k];
  const { results } = await c.env.DB.prepare(sql)
    .bind(...params)
    .all();
  return c.json({ count: results.length, results });
});

// REST: get node
app.get("/api/node/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT n.*,p.doc_no AS parent_doc_no,p.title AS parent_title
     FROM docs n LEFT JOIN docs p ON n.parent_id=p.id
     WHERE ${isUuid(id) ? "n.id" : "n.doc_no"}=? LIMIT 1`,
  )
    .bind(id)
    .first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// REST: entity view
app.get("/api/entity/:name", async (c) => {
  const name = c.req.param("name").toLowerCase();
  const entity = await c.env.DB.prepare(
    `SELECT id,slug,name,entity_type,subtype,defining_doc_id FROM entities WHERE slug=? LIMIT 1`,
  )
    .bind(name)
    .first<{ id: string; slug: string; name: string; entity_type: string; subtype: string; defining_doc_id: string | null }>();
  const entityId = entity?.id ?? null;
  const rootUuid = entity?.defining_doc_id ?? agentRootUuid(name);

  const [byEdge, byDocNo, responsibilities, activeData] = await Promise.all([
    entityId
      ? c.env.DB.prepare(`SELECT DISTINCT n.id,n.doc_no,n.title,n.type,n.depth
                          FROM edges e JOIN docs n ON e.to_id=n.id WHERE e.from_id=? LIMIT 100`)
          .bind(entityId)
          .all()
      : Promise.resolve({ results: [] }),
    rootUuid
      ? c.env.DB.prepare(
          `WITH RECURSIVE tree(id) AS (
             SELECT ? UNION ALL
             SELECT d.id FROM docs d JOIN tree t ON d.parent_id = t.id
           )
           SELECT d.id,d.doc_no,d.title,d.type,d.depth
           FROM docs d JOIN tree t ON d.id = t.id
           ORDER BY d.doc_no LIMIT 200`,
        )
          .bind(rootUuid)
          .all()
      : Promise.resolve({ results: [] }),
    entityId
      ? c.env.DB.prepare(`SELECT n.id,n.doc_no,n.title,n.type FROM edges e
                          JOIN docs n ON e.to_id=n.id
                          WHERE e.from_id=? AND e.edge_type='responsible_for' ORDER BY n.doc_no`)
          .bind(entityId)
          .all()
      : Promise.resolve({ results: [] }),
    entityId
      ? c.env.DB.prepare(`SELECT n.id,n.doc_no,n.title,e.edge_type FROM edges e
                          JOIN docs n ON e.to_id=n.id
                          WHERE e.from_id=? AND n.type IN ('Active Data Controller','Active Data') ORDER BY n.doc_no`)
          .bind(entityId)
          .all()
      : Promise.resolve({ results: [] }),
  ]);

  return c.json({
    entity: { slug: name, ...entity },
    nodes: [...byEdge.results, ...byDocNo.results],
    responsibilities: responsibilities.results,
    activeData: activeData.results,
  });
});

// REST: address lookup
app.get("/api/address/:addr", async (c) => {
  const addr = c.req.param("addr").toLowerCase();
  const chain = c.req.query("chain");
  const { results: addrRows } = await c.env.DB
    .prepare(`
      SELECT a.address, a.chain, a.label, a.chainlog_id, a.etherscan_name,
             a.is_contract, a.is_proxy, a.implementation,
             a.roles AS roles_json, a.aliases AS aliases_json,
             a.expected_tokens AS expected_tokens_json,
             a.chain_state AS chain_state_json, a.state_block, a.entity_id,
             e.slug AS entity_slug, e.name AS entity_name,
             e.entity_type AS entity_type, e.subtype AS entity_subtype
      FROM addresses a LEFT JOIN entities e ON a.entity_id = e.id
      WHERE a.address = ? ${chain ? "AND a.chain = ?" : ""}
    `)
    .bind(...(chain ? [addr, chain] : [addr]))
    .all();
  if (addrRows.length === 0) return c.json({ error: "Not found", address: addr }, 404);

  const { results: edges } = await c.env.DB
    .prepare(`SELECT e.edge_type, e.source_doc_nos, n.id AS doc_id, n.doc_no, n.title, n.type
              FROM edges e LEFT JOIN docs n ON e.from_id = n.id AND e.from_type='doc'
              WHERE e.to_id = ? AND e.to_type = 'address' ORDER BY n.doc_no LIMIT 200`)
    .bind(addr)
    .all();

  const records = (addrRows as any[]).map((r) => {
    const { roles_json, aliases_json, expected_tokens_json, chain_state_json, ...rest } = r;
    return {
      ...rest,
      roles: safeJson(roles_json, []),
      aliases: safeJson(aliases_json, []),
      expected_tokens: safeJson(expected_tokens_json, []),
      chain_state: safeJson(chain_state_json, null),
    };
  });
  return c.json({ address: addr, records, edges });
});

// REST: graph traverse
app.get("/api/traverse/:id", async (c) => {
  const id = c.req.param("id");
  const hops = Math.min(parseInt(c.req.query("hops") ?? "2"), 4);
  const edgeType = c.req.query("type");

  const start = await c.env.DB.prepare(
    `SELECT id FROM docs WHERE ${isUuid(id) ? "id" : "doc_no"}=? LIMIT 1`,
  )
    .bind(id)
    .first<{ id: string }>();
  if (!start) return c.json({ error: "Not found" }, 404);

  const typeFilter = edgeType ? "AND e.edge_type=?" : "";
  const params: unknown[] = [start.id, hops, ...(edgeType ? [edgeType] : [])];

  const { results } = await c.env.DB.prepare(`
    WITH RECURSIVE reachable(id,depth) AS (
      SELECT ?,0
      UNION
      SELECT e.to_id,r.depth+1 FROM edges e JOIN reachable r ON e.from_id=r.id ${typeFilter}
      WHERE r.depth<?
    )
    SELECT DISTINCT n.id,n.doc_no,n.title,n.type,r.depth
    FROM reachable r JOIN docs n ON r.id=n.id WHERE n.id!=?
    ORDER BY r.depth,n.doc_no
  `)
    .bind(...params, start.id)
    .all();

  return c.json({ count: results.length, results });
});

export default app;
