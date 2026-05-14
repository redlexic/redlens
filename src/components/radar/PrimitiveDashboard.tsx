import { useRef } from "react";
import { Link } from "../Link";
import type { AgentPrimitiveStat, CategoryStat, PrimitiveStat } from "../../lib/primitiveStats";
import { toAnchorId } from "../../lib/anchorId";
import { actorHref } from "../../lib/routes";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import { useScrollRestore } from "../../hooks/useScrollRestore";

const execCodec = urlString(null);

function shortenCategoryTitle(title: string): string {
  return title.replace(/\s*Primitives\s*/i, "").trim();
}

const HEADERS = [
  { key: "IP", full: "In Progress" },
  { key: "A",  full: "Active" },
  { key: "S",  full: "Suspended" },
  { key: "C",  full: "Completed" },
];

const BORDER = "1px solid #4e3a35";

const cellPadding = "0.175rem"

const TH: React.CSSProperties = {
  width: "1.5rem",
  textAlign: "center",
  borderLeft: BORDER,
  paddingLeft: cellPadding,
  paddingRight: cellPadding,
  color: "var(--tan-2)",
  cursor: "default",
  fontWeight: "normal",
};

const TD: React.CSSProperties = {
  textAlign: "center",
  borderLeft: BORDER,
  paddingLeft: cellPadding,
  paddingRight: cellPadding,
  color: "var(--tan-3)",
};

const TD_DIM: React.CSSProperties = { ...TD, opacity: 0.5 };

const ROW_COLORS = ["#221614", "#261916"] as const;

function PrimitiveRow({ p, rowIndex, agentSlug }: { p: PrimitiveStat; rowIndex: number; agentSlug: string }) {
  return (
    <tr style={{ background: ROW_COLORS[rowIndex % 2] }}>
      <td className="py-0.5" style={{ maxWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <Link to={actorHref(agentSlug, p.st)} className="mono text-[11px] hover:underline w-full text-left truncate block" style={{ color: "var(--tan-3)" }} title={p.title}>
          {p.title}
        </Link>
      </td>
      {[p.pending, p.active, p.suspended, p.completed].map((n, i) => (
        <td key={i} className="mono text-[10px] py-0.5" style={n === 0 ? TD_DIM : TD} title={`${n} ${p.title} ${n === 1 ? "Primitive" : "Primitives"} ${HEADERS[i].full}`}>{n}</td>
      ))}
    </tr>
  );
}

function CategoryRows({ cat, startIndex, agentSlug }: { cat: CategoryStat; startIndex: number; agentSlug: string }) {
  const title = shortenCategoryTitle(cat.title);
  return (
    <>
      <tr>
        <td colSpan={5} className="pt-3 pb-0.5" style={{ borderBottom: BORDER }}>
          <Link to={actorHref(agentSlug, toAnchorId(cat.title))} className="mono text-[10px] uppercase tracking-wider hover:underline" style={{ color: "var(--tan-2)" }}>
            {title}
          </Link>
        </td>
      </tr>
      {cat.primitives.length === 0 ? (
        <tr style={{ background: ROW_COLORS[startIndex % 2] }}>
          <td className="mono text-[11px] py-0.5" style={{ color: "var(--tan-3)", opacity: 0.5 }}>—</td>
          {[0, 0, 0, 0].map((_, i) => (
            <td key={i} className="mono text-[10px] py-0.5" style={TD_DIM} title={`0 ${HEADERS[i].full}`}>0</td>
          ))}
        </tr>
      ) : (
        cat.primitives.map((p, i) => (
          <PrimitiveRow key={p.st} p={p} rowIndex={startIndex + i} agentSlug={agentSlug} />
        ))
      )}
    </>
  );
}

function AgentPanel({ agent }: { agent: AgentPrimitiveStat }) {
  let rowCounter = 0;
  return (
    <article className="rounded p-4 break-inside-avoid" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "auto" }} />
          {HEADERS.map((h) => <col key={h.key} style={{ width: "1.5rem" }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="text-left pb-2" style={{ fontWeight: "600", fontSize: "0.875rem", color: "var(--tan)" }}>
              <Link to={actorHref(agent.slug)} className="hover:underline">{agent.name}</Link>
            </th>
            {HEADERS.map((h) => (
              <th key={h.key} className="mono text-[10px] pb-2" title={h.full} style={TH}>{h.key}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {agent.categories.map((cat) => {
            const startIndex = rowCounter;
            rowCounter += cat.primitives.length || 1;
            return <CategoryRows key={cat.title} cat={cat} startIndex={startIndex} agentSlug={agent.slug} />;
          })}
        </tbody>
      </table>
    </article>
  );
}

interface Props {
  agents: AgentPrimitiveStat[];
}

export function PrimitiveDashboard({ agents }: Props) {
  const [executorFilter, setExecutorFilter] = useUrlState("exec", execCodec);

  const executors = [...new Map(
    agents.filter(a => a.executorSlug).map(a => [a.executorSlug!, a.executorName!])
  ).entries()];

  const visible = executorFilter
    ? agents.filter(a => a.executorSlug === executorFilter)
    : agents;

  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollRestore(scrollRef, agents.length > 0);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="text-xl" style={{ fontFamily: "Lora, serif", color: "var(--tan)" }}>
          Prime Agent Primitive Stats
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExecutorFilter(null)}
            className="mono text-[10px] px-1.5 py-0.5 rounded"
            style={{
              border: "1px solid var(--border)",
              color: executorFilter === null ? "var(--tan)" : "var(--tan-3)",
              background: executorFilter === null ? "var(--hover)" : "transparent",
            }}
          >
            All
          </button>
          {executors.map(([slug, name]) => (
            <button
              key={slug}
              onClick={() => setExecutorFilter(slug === executorFilter ? null : slug)}
              className="mono text-[10px] px-1.5 py-0.5 rounded"
              style={{
                border: "1px solid var(--border)",
                color: executorFilter === slug ? "var(--tan)" : "var(--tan-3)",
                background: executorFilter === slug ? "var(--hover)" : "transparent",
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div style={{ columns: "280px", columnGap: "1rem" }}>
        {visible.map((agent) => (
          <div key={agent.slug} className="mb-4">
            <AgentPanel agent={agent} />
          </div>
        ))}
      </div>
    </div>
  );
}
