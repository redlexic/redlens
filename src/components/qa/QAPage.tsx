import { useState, useEffect, useRef } from "react";
import { transformersJS } from "@browser-ai/transformers-js";
import {
  ensureModelReady, runQA,
  type QAEvent, type QAModel, type QueryFn, type QueryParams, type QueryResult,
} from "../../lib/qa";
import type { SearchHit, SearchHitAncestor } from "../../types";

const MCP_BASE = import.meta.env.DEV
  ? "http://localhost:8787"
  : "https://redlens-mcp.anscharo.workers.dev";

const MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";
const IS_OOM = (msg: string) => msg.includes("Failed to allocate memory") || msg.includes("OrtRun");
const IS_NO_WEBGPU = (msg: string) => msg.includes("Unsupported device") || msg.includes("Should be one of: wasm");

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchEntitySlugs(): Promise<string[]> {
  try {
    const res = await fetch(`${MCP_BASE}/api/entities`);
    if (!res.ok) return [];
    const data = await res.json() as { entities: { slug: string }[] };
    return (data.entities ?? []).map((e) => e.slug);
  } catch {
    return [];
  }
}

function mapHit(r: Partial<SearchHit> & { ancestors?: SearchHitAncestor[]; content?: string }): SearchHit {
  return {
    id: r.id ?? "", score: r.score ?? 0, doc_no: r.doc_no ?? "",
    title: r.title ?? "", titleHtml: r.title ?? "", type: r.type ?? "",
    depth: r.depth ?? 0, parentId: null, snippet: r.snippet ?? "",
    matchReason: "api", content: r.content, ancestors: r.ancestors,
  };
}

async function queryViaAPI(params: QueryParams): Promise<QueryResult> {
  const url = new URL(`${MCP_BASE}/api/query`);
  if (params.q)              url.searchParams.set("q", params.q);
  if (params.entity)         url.searchParams.set("entity", params.entity);
  if (params.edgeTypes?.length) url.searchParams.set("edge_types", params.edgeTypes.join(","));
  if (params.targetType)     url.searchParams.set("target_type", params.targetType);
  if (params.direction)      url.searchParams.set("direction", params.direction);
  if (params.hops)           url.searchParams.set("hops", String(params.hops));
  if (params.recentCommits)  url.searchParams.set("recent_commits", String(params.recentCommits));
  if (params.since)          url.searchParams.set("since", params.since);
  if (params.until)          url.searchParams.set("until", params.until);
  if (params.changeType)     url.searchParams.set("change_type", params.changeType);
  if (params.status)         url.searchParams.set("status", params.status);
  if (params.ancestorId)     url.searchParams.set("ancestor_id", params.ancestorId);
  if (params.viaEntityType)  url.searchParams.set("via_entity_type", params.viaEntityType);
  if (params.includeParams)  url.searchParams.set("include_params", "true");
  url.searchParams.set("enrich", "true");
  url.searchParams.set("k", "6");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Query API error: ${res.status}`);
  const data = await res.json() as {
    mode: string;
    results?: unknown[];
    by_relationship?: Record<string, unknown[]>;
  };

  console.log("[qa] query_atlas", { params, response: data });

  if (data.mode === "entity_broad" && data.by_relationship) {
    const byRelationship: Record<string, SearchHit[]> = {};
    for (const [rel, rows] of Object.entries(data.by_relationship)) {
      byRelationship[rel] = (rows as any[]).map(mapHit);
    }
    return { mode: "entity_broad", byRelationship };
  }

  return {
    mode: data.mode as "search" | "entity_narrow" | "hybrid_graph",
    hits: (data.results ?? []).map((r) => mapHit(r as any)),
  };
}

// ── Trace types ───────────────────────────────────────────────────────────────

type TraceEntry = {
  params: QueryParams;
  summary: string;
  detail: string | null;
};

function traceLabel(params: QueryParams): string {
  const parts: string[] = [];
  if (params.entity) parts.push(`entity=${params.entity}`);
  if (params.edgeTypes?.length) parts.push(`edges=[${params.edgeTypes.join(",")}]`);
  if (params.q) parts.push(`"${params.q}"`);
  if (params.targetType) parts.push(`type=${params.targetType}`);
  return parts.join(" + ") || "(empty)";
}

function resultDetail(result: QueryResult): string {
  if (result.mode === "entity_broad") {
    return Object.entries(result.byRelationship)
      .map(([rel, hits]) => `${rel}: ${hits.length}`)
      .join(", ");
  }
  return result.hits.slice(0, 3).map((h) => `[${h.doc_no}] ${h.title}`).join("; ");
}

// ── Answer renderer ───────────────────────────────────────────────────────────

function renderAnswer(text: string) {
  const parts = text.split(/(<think>[\s\S]*?<\/think>|<think>[\s\S]*$)/);
  return parts.map((part, i) => {
    const m = part.match(/^<think>([\s\S]*?)(?:<\/think>|$)/);
    if (m) {
      return (
        <em key={i} className="block text-xs" style={{ opacity: 0.45, fontStyle: "italic", marginBottom: "0.5rem" }}>
          {m[1].trim()}
        </em>
      );
    }
    return part ? <span key={i}>{part}</span> : null;
  });
}

// ── Result cards ─────────────────────────────────────────────────────────────

function HitCard({ hit }: { hit: SearchHit }) {
  const breadcrumb = hit.ancestors?.map((a) => a.title).join(" › ");
  return (
    <article className="mb-3 p-3 rounded text-sm" style={{ background: "var(--surface)" }}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-mono text-xs opacity-50">{hit.doc_no}</span>
        <span className="font-medium">{hit.title}</span>
        <span className="text-xs opacity-40 ml-auto">{hit.type}</span>
      </div>
      {breadcrumb && (
        <div className="text-xs opacity-40 mb-1">{breadcrumb}</div>
      )}
      {hit.snippet && (
        <div
          className="text-xs leading-relaxed opacity-70"
          dangerouslySetInnerHTML={{ __html: hit.snippet }}
        />
      )}
    </article>
  );
}

function ResultCards({ result }: { result: QueryResult }) {
  if (result.mode === "entity_broad") {
    return (
      <div className="mt-4">
        {Object.entries(result.byRelationship).map(([rel, hits]) => (
          <div key={rel} className="mb-4">
            <div className="text-xs font-mono mb-2 opacity-50">{rel}</div>
            {hits.map((h) => <HitCard key={h.id} hit={h} />)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-4">
      {result.hits.map((h) => <HitCard key={h.id} hit={h} />)}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

type Device = "webgpu" | "wasm";

// Safari has WebGPU in the DOM but ONNX Runtime Web doesn't support it there.
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const defaultDevice: Device = isSafari ? "wasm" : "webgpu";

export function QAPage() {
  const [question, setQuestion]       = useState("");
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [loadingPct, setLoadingPct]   = useState(0);
  const [running, setRunning]         = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [traces, setTraces]           = useState<TraceEntry[]>([]);
  const [answer, setAnswer]           = useState<string | null>(null);
  const [results, setResults]         = useState<QueryResult | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [isOom, setIsOom]             = useState(false); // used for error message styling
  const [device, setDevice]           = useState<Device>(defaultDevice);
  const [entitySlugs, setEntitySlugs] = useState<string[]>([]);
  const [heapMb, setHeapMb]           = useState<number | null>(null);

  const modelRef      = useRef<QAModel | null>(null);
  const modelReadyRef = useRef(false);

  // Poll JS heap while running (Chrome only)
  useEffect(() => {
    const mem = (performance as any).memory;
    if (!mem) return;
    if (!running) { setHeapMb(Math.round(mem.usedJSHeapSize / 1048576)); return; }
    const id = setInterval(() => setHeapMb(Math.round(mem.usedJSHeapSize / 1048576)), 500);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    modelRef.current = transformersJS(MODEL_ID, {
      device,
      // Cap the KV cache to 4K tokens instead of the model's full 32K.
      // Reduces peak VRAM from ~3.5GB to ~450MB on WebGPU.
      model_kwargs: { max_position_embeddings: 4096 },
    });
    modelReadyRef.current = false;
    setModelStatus("idle");
    fetchEntitySlugs().then(setEntitySlugs);
  }, [device]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const model = modelRef.current;
    if (!question.trim() || !model || running) return;

    setRunning(true);
    setGenerating(false);
    setTraces([]);
    setAnswer(null);
    setResults(null);
    setError(null);
    setIsOom(false);

    const emit = (event: QAEvent) => {
      switch (event.type) {
        case "loading": setModelStatus("loading"); setLoadingPct(event.progress); break;
        case "ready":   setModelStatus("ready"); break;
        case "tool-call":
          setTraces((t) => [...t, { params: event.params, summary: traceLabel(event.params), detail: null }]);
          break;
        case "tool-result":
          setTraces((t) => {
            const c = [...t];
            if (c.length) c[c.length - 1] = { ...c[c.length - 1], detail: resultDetail(event.result) };
            return c;
          });
          setResults(event.result);
          setRunning(false);
          break;
        case "answer-start": setGenerating(true); break;
        case "answer-chunk":
          setGenerating(false);
          setAnswer((prev) => (prev ?? "") + event.text);
          break;
        case "answer": setRunning(false); break;
        case "error":
          if (IS_OOM(event.message)) {
            setIsOom(true);
            setDevice("wasm");
            setError("GPU out of memory — switched to CPU mode. Ask your question again.");
          } else if (IS_NO_WEBGPU(event.message)) {
            setDevice("wasm");
            setError("WebGPU not supported in this browser — switched to CPU mode. Ask your question again.");
          } else {
            setError(event.message);
          }
          setRunning(false);
          break;
      }
    };

    if (!modelReadyRef.current) {
      const ok = await ensureModelReady(model, emit);
      if (!ok) return;
      modelReadyRef.current = true;
    }

    await runQA(question, model, queryViaAPI, entitySlugs, emit, device === "webgpu" ? 200 : 512, device);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8" style={{ color: "var(--tan)" }}>
      <h1 className="text-2xl mb-4">
        Atlas Q&amp;A{" "}
        <span className="text-xs font-mono ml-2" style={{ color: "var(--accent)" }}>
          Qwen3-0.6B · prototype
        </span>
      </h1>

      {/* Device selector + memory */}
      <div className="flex items-center gap-2 mb-6 text-xs font-mono">
        {(["webgpu", "wasm"] as Device[]).map((d) => (
          <button
            key={d}
            onClick={() => setDevice(d)}
            disabled={running}
            className="px-2 py-1 rounded cursor-pointer disabled:opacity-40"
            style={{
              background: device === d ? "var(--hover)" : "transparent",
              color: device === d ? "var(--tan)" : "var(--tan-3)",
              border: `1px solid ${device === d ? "var(--accent)" : "var(--hover)"}`,
            }}
          >
            {d === "webgpu" ? "GPU" : "CPU"}
          </button>
        ))}
        {device === "wasm" && <span className="opacity-50">slower but reliable</span>}
        {heapMb !== null && (
          <span className="ml-auto tabular-nums opacity-40">{heapMb} MB heap</span>
        )}
      </div>

      {modelStatus === "loading" && (
        <div className="text-sm mb-4" style={{ color: "var(--tan-2)" }}>
          <div className="flex items-center gap-2">
            <span>Downloading model</span>
            <span className="tabular-nums ml-auto" style={{ minWidth: "3.5ch", textAlign: "right" }}>
              {loadingPct > 0 ? `${loadingPct}%` : ""}
            </span>
          </div>
          <div className="text-xs opacity-50 mt-0.5">~430 MB · cached in IndexedDB after first load</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 mb-8">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What Active Data does Spark control?"
          disabled={running}
          className="flex-1 px-3 py-2 rounded text-sm border"
          style={{ background: "var(--surface)", borderColor: "var(--hover)", color: "var(--tan)" }}
        />
        <button
          type="submit"
          disabled={running || !question.trim()}
          className="px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-40"
          style={{ background: "var(--red)", color: "var(--tan)", border: "none" }}
        >
          {running ? "…" : "Ask"}
        </button>
      </form>

      {traces.map((t, i) => (
        <div key={i} className="mb-3 text-sm font-mono">
          <span style={{ color: "var(--accent)" }}>query_atlas</span>
          <span className="ml-2" style={{ color: "var(--tan-3)" }}>{t.summary}</span>
          {t.detail && (
            <div className="mt-1 ml-4 text-xs" style={{ color: "var(--tan-2)" }}>
              {t.detail}
            </div>
          )}
        </div>
      ))}

      {running && traces.length > 0 && (
        <div className="text-sm mt-2 mb-2" style={{ color: "var(--tan-3)" }}>Searching…</div>
      )}

      {results && <ResultCards result={results} />}

      {answer && (
        <div className="pl-4 leading-relaxed mt-4" style={{ borderLeft: "3px solid var(--red)" }}>
          {renderAnswer(answer)}
          {running && <span className="animate-pulse">▌</span>}
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm" style={{ color: isOom ? "var(--tan-2)" : "var(--accent)" }}>
          {error}
        </p>
      )}
    </main>
  );
}
