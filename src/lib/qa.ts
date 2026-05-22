import { streamText } from "ai";
import { type TransformersJSLanguageModel } from "@browser-ai/transformers-js";
import type { SearchHit } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

export type QueryParams = {
  q?: string;
  entity?: string;
  edgeTypes?: string[];
  targetType?: string;
  direction?: "out" | "in" | "both";
  hops?: number;
  // Filter dimensions
  recentCommits?: number; // within last N commits of HEAD (preferred over since for "recent")
  since?: string;         // ISO date or "30d"
  until?: string;
  changeType?: string;    // added|modified|removed|moved
  status?: string;        // Active|Suspended|Completed|Inactive
  ancestorId?: string;    // restrict to descendants of this node
  // Traversal
  viaEntityType?: string; // entity → entities of this type → their docs
  // Enrichment
  includeParams?: boolean;
};

export type QueryResultFlat = {
  mode: "search" | "entity_narrow" | "hybrid_graph";
  hits: SearchHit[];
};

export type QueryResultGrouped = {
  mode: "entity_broad";
  byRelationship: Record<string, SearchHit[]>;
};

export type QueryResult = QueryResultFlat | QueryResultGrouped;

export type QueryFn = (params: QueryParams) => Promise<QueryResult>;

export type QAModel = TransformersJSLanguageModel;

export type QAEvent =
  | { type: "loading"; progress: number; file: string }
  | { type: "ready" }
  | { type: "tool-call"; params: QueryParams }
  | { type: "tool-result"; result: QueryResult }
  | { type: "answer-start" }
  | { type: "answer-chunk"; text: string }
  | { type: "answer"; text: string }
  | { type: "error"; message: string };

// ── System prompt ─────────────────────────────────────────────────────────────

const ATLAS_DOC_TYPES = [
  "Scope", "Article", "Section", "Core", "Type Specification",
  "Active Data Controller", "Active Data", "Annotation",
  "Action Tenet", "Scenario", "Scenario Variation", "Needed Research",
] as const;

const EDGE_TYPES = [
  "responsible_for", "active_data_for", "responsible_party_for",
  "has_executor", "instance_of", "cites", "has_address",
];

const RULES =
  "## Rules:\n" +
  "- Named entity → entity (add nothing else unless question also specifies relationship/type)\n" +
  "- Topic only → q only\n" +
  "- Entity + relationship type → entity + edge_types\n" +
  "- Entity + doc type → entity + target_type\n" +
  "- Entity + topic → entity + q\n" +
  "- 'list all X' → target_type only\n" +
  "- 'Xs served by / connected to Y' → entity=Y + via_entity_type=X\n" +
  "- 'updated recently' / 'changed lately' → recent_commits=10\n" +
  "- 'changed in last N days' → since=Nd\n" +
  "- 'active only' / 'suspended' → status=Active (or Suspended/Completed/Inactive)\n" +
  "- 'under scope X' / 'in section Y' → ancestor_id=<doc_no or uuid>\n" +
  "- 'with parameters' / 'instance params' → include_params=true\n\n" +
  "Combine freely. recent_commits is preferred over since for vague 'recent' questions.\n" +
  "Do NOT add filters unless the question explicitly implies them.\n";

function buildSystemPrompt(entitySlugs: string[], device: "webgpu" | "wasm"): string {
  const entityHint = entitySlugs.length > 0
    ? `Known entity slugs: ${entitySlugs.join(", ")}.\n`
    : "Entity slugs are lowercase-hyphenated (e.g. spark, grove, keel, skybase, obex, pattern).\n";

  return (
    "You are a query assistant for Sky Atlas governance documentation. " +
    "Output a single JSON tool call. No other text.\n\n" +
    "Format: {\"name\": \"query_atlas\", \"arguments\": { ...params }}\n" +
    "Params: q, entity, edge_types[], target_type, via_entity_type, since, until, status, ancestor_id, include_params, direction, hops\n\n" +
    RULES +
    entityHint +
    `Edge types: ${EDGE_TYPES.join(", ")}.\n` +
    `Doc types: ${ATLAS_DOC_TYPES.join(", ")}.`
  );
}

// ── Parse tool call from raw model text ───────────────────────────────────────

function parseToolCall(raw: string): QueryParams | null {
  // Strip <think>...</think> blocks first
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/, "").trim();

  const ALL_KEYS = "q|entity|edge_types|target_type|via_entity_type|since|until|change_type|status|ancestor_id|include_params|direction|hops";
  const patterns = [
    /"name"\s*:\s*"query_atlas"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/,
    /<tool_call>\s*\{[\s\S]*?"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}\s*<\/tool_call>/,
    new RegExp(`^\\s*(\\{"(?:${ALL_KEYS})"[\\s\\S]*?\\})\\s*$`),
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    try {
      const args = JSON.parse(m[1]);
      const params: QueryParams = {
        q:              args.q ?? undefined,
        entity:         args.entity ?? undefined,
        edgeTypes:      args.edge_types ?? undefined,
        targetType:     args.target_type ?? undefined,
        direction:      args.direction ?? undefined,
        hops:           args.hops ?? undefined,
        recentCommits:  args.recent_commits ?? undefined,
        since:          args.since ?? undefined,
        until:          args.until ?? undefined,
        changeType:     args.change_type ?? undefined,
        status:         args.status ?? undefined,
        ancestorId:     args.ancestor_id ?? undefined,
        viaEntityType:  args.via_entity_type ?? undefined,
        includeParams:  args.include_params ?? undefined,
      };
      if (Object.values(params).some((v) => v !== undefined)) return params;
    } catch { /* try next pattern */ }
  }
  return null;
}

// ── Model readiness ───────────────────────────────────────────────────────────

export async function ensureModelReady(
  model: QAModel,
  emit: (e: QAEvent) => void,
): Promise<boolean> {
  const availability = await model.availability();
  if (availability === "unavailable") {
    emit({ type: "error", message: "This browser does not support in-browser inference." });
    return false;
  }
  if (availability === "downloadable") {
    try {
      await model.createSessionWithProgress((progress: number) => {
        emit({ type: "loading", progress: Math.round(progress * 100), file: "" });
      });
    } catch (err) {
      emit({ type: "error", message: String(err) });
      return false;
    }
  }
  emit({ type: "ready" });
  return true;
}

// ── Main QA runner ────────────────────────────────────────────────────────────

export async function runQA(
  question: string,
  model: QAModel,
  query: QueryFn,
  entitySlugs: string[],
  emit: (e: QAEvent) => void,
  maxTokens = 256,
  device: "webgpu" | "wasm" = "webgpu",
): Promise<void> {
  try {
    // Step 1: generate the tool call text
    emit({ type: "answer-start" });
    const result = streamText({
      model,
      system: buildSystemPrompt(entitySlugs, device),
      messages: [{ role: "user", content: question }],
      maxTokens,
    });

    let raw = "";
    for await (const chunk of result.textStream) {
      raw += chunk;
      emit({ type: "answer-chunk", text: chunk });
    }

    // Step 2: parse the tool call from model output
    const params = parseToolCall(raw);
    if (!params) {
      emit({ type: "error", message: `Model did not produce a valid query.\nRaw output: ${raw.slice(0, 200)}` });
      return;
    }

    // Step 3: execute and return results
    emit({ type: "tool-call", params });
    const queryResult = await query(params);
    emit({ type: "tool-result", result: queryResult });
    emit({ type: "answer", text: "" });

  } catch (err) {
    emit({ type: "error", message: String(err) });
  }
}
