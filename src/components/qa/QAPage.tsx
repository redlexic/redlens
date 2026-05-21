import { useState, useEffect, useRef } from "react";
import { transformersJS } from "@browser-ai/transformers-js";
import {
  ensureModelReady, runQA,
  type QAEvent, type QAModel, type SearchFn,
} from "../../lib/qa";
import type { SearchHit } from "../../types";

const MCP_SEARCH = "https://redlens-mcp.anscharo.workers.dev/api/search";

async function searchViaAPI(q: string): Promise<SearchHit[]> {
  const url = `${MCP_SEARCH}?q=${encodeURIComponent(q)}&limit=5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search API error: ${res.status}`);
  const data = await res.json() as { results: Partial<SearchHit>[] };
  return (data.results ?? []).map((r) => ({
    id: r.id ?? "",
    score: r.score ?? 0,
    doc_no: r.doc_no ?? "",
    title: r.title ?? "",
    titleHtml: r.title ?? "",
    type: r.type ?? "",
    depth: r.depth ?? 0,
    parentId: null,
    snippet: r.snippet ?? "",
    matchReason: "api",
  }));
}

type TraceEntry = { query: string; titles: string[] };

export function QAPage() {
  const [question, setQuestion] = useState("");
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [loadingPct, setLoadingPct] = useState(0);
  const [running, setRunning] = useState(false);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const modelRef = useRef<QAModel | null>(null);
  const modelReadyRef = useRef(false);

  useEffect(() => {
    modelRef.current = transformersJS("onnx-community/Qwen3-0.6B-ONNX", { device: "webgpu" });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const model = modelRef.current;
    if (!question.trim() || !model || running) return;

    setRunning(true);
    setTraces([]);
    setAnswer(null);
    setError(null);

    const emit = (event: QAEvent) => {
      if (event.type === "loading") { setModelStatus("loading"); setLoadingPct(event.progress); }
      else if (event.type === "ready") { setModelStatus("ready"); }
      else if (event.type === "tool-call") {
        setTraces((t) => [...t, { query: event.query, titles: [] }]);
      } else if (event.type === "tool-result") {
        const titles = event.hits.slice(0, 3).map((h) => `[${h.doc_no}] ${h.title}`);
        setTraces((t) => {
          const c = [...t];
          if (c.length) c[c.length - 1] = { ...c[c.length - 1], titles };
          return c;
        });
      } else if (event.type === "answer") {
        setAnswer(event.text);
        setRunning(false);
      } else if (event.type === "error") {
        setError(event.message);
        setRunning(false);
      }
    };

    if (!modelReadyRef.current) {
      const ok = await ensureModelReady(model, emit);
      if (!ok) return;
      modelReadyRef.current = true;
    }

    await runQA(question, model, searchViaAPI, emit);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8" style={{ color: "var(--tan)" }}>
      <h1 className="text-2xl mb-6">
        Atlas Q&A{" "}
        <span className="text-xs font-mono ml-2" style={{ color: "var(--accent)" }}>
          Qwen3-0.6B · prototype
        </span>
      </h1>

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
          placeholder="e.g. Who controls the Surplus Buffer?"
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
          <span style={{ color: "var(--accent)" }}>search_atlas</span>
          <span style={{ color: "var(--tan-3)" }}>{" "}&ldquo;{t.query}&rdquo;</span>
          {t.titles.length > 0 && (
            <ul className="mt-1 ml-4 list-disc" style={{ color: "var(--tan-2)" }}>
              {t.titles.map((title, j) => <li key={j}>{title}</li>)}
            </ul>
          )}
        </div>
      ))}

      {answer && (
        <div className="pl-4 leading-relaxed" style={{ borderLeft: "3px solid var(--red)" }}>
          {answer}
        </div>
      )}

      {error && (
        <p className="text-sm mt-4" style={{ color: "var(--accent)" }}>Error: {error}</p>
      )}
    </main>
  );
}
