import { Link } from "../Link";
import type { AgentPrimitiveStat, CategoryStat, PrimitiveStat } from "../../lib/primitiveStats";
import { toAnchorId } from "../../lib/anchorId";
import { actorHref } from "../../lib/routes";
import { useUrlState, urlString } from "../../hooks/useUrlState";

const execCodec = urlString(null);

function shortenCategoryTitle(title: string): string {
  return title.replace(/\s*Primitives\s*/i, "").trim();
}

// Instances (A/S/C) and Invocations are atlas-distinct concepts (A.2.2.1.3 vs
// A.2.2.1.4). The Invocations column carries a thicker left divider so it
// reads as a separate group, not a fourth instance status.
const HEADERS = [
  { key: "A",   full: "Active",     group: "instance" as const },
  { key: "S",   full: "Suspended",  group: "instance" as const },
  { key: "C",   full: "Completed",  group: "instance" as const },
  { key: "INV", full: "Invocations in Progress", group: "invocation" as const },
];

const BORDER = "1px solid #4e3a35";
const GROUP_BORDER = "2px solid #6b4a40";

const cellPadding = "0.175rem"

function thStyle(h: typeof HEADERS[number]): React.CSSProperties {
  return {
    width: h.key === "INV" ? "2rem" : "1.5rem",
    textAlign: "center",
    borderLeft: h.group === "invocation" ? GROUP_BORDER : BORDER,
    paddingLeft: cellPadding,
    paddingRight: cellPadding,
    color: "var(--tan)",
    cursor: "default",
    fontWeight: "normal",
  };
}

function tdStyle(h: typeof HEADERS[number], dim: boolean): React.CSSProperties {
  return {
    textAlign: "center",
    borderLeft: h.group === "invocation" ? GROUP_BORDER : BORDER,
    paddingLeft: cellPadding,
    paddingRight: cellPadding,
    color: "var(--tan-2)",
    opacity: dim ? 0.5 : undefined,
  };
}

const ROW_COLORS = ["#110b08", "#1a0e0b"] as const;

// Match the anchor scheme baked into ActorInstances: instance status cells
// link to `<prim.st>-<status>` (first card of that status group); the
// invocation cell links to `invocations-<prim.st>` (the primitive's
// sub-section within the Invocations top-level section).
function anchorFor(h: typeof HEADERS[number], primSt: string): string {
  if (h.group === "invocation") return `invocations-${primSt}`;
  return `${primSt}-${h.full.toLowerCase()}`;
}

function PrimitiveRow({ p, rowIndex, agentSlug }: { p: PrimitiveStat; rowIndex: number; agentSlug: string }) {
  return (
    <tr style={{ background: ROW_COLORS[rowIndex % 2] }}>
      <td className="py-0.5 pl-3" style={{ maxWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <Link to={actorHref(agentSlug, p.st)} className="mono text-[11px] hover:underline w-full text-left truncate block" style={{ color: "var(--tan-2)" }} title={p.title}>
          {p.title}
        </Link>
      </td>
      {[p.active, p.suspended, p.completed, p.invocations].map((n, i) => {
        const h = HEADERS[i];
        const style = tdStyle(h, n === 0);
        const title = `${n} ${p.title} ${h.full}`;
        if (n === 0) {
          return <td key={i} className="mono text-[10px] py-0.5" style={style} title={title}>{n}</td>;
        }
        return (
          <td key={i} className="mono text-[10px] py-0.5" style={style} title={title}>
            <Link to={actorHref(agentSlug, anchorFor(h, p.st))} className="hover:underline" style={{ color: "inherit" }}>
              {n}
            </Link>
          </td>
        );
      })}
    </tr>
  );
}

function CategoryRows({ cat, startIndex, agentSlug }: { cat: CategoryStat; startIndex: number; agentSlug: string }) {
  const title = shortenCategoryTitle(cat.title);
  return (
    <>
      <tr>
        <td colSpan={5} className="pt-3 pb-0.5 pl-3" style={{ borderBottom: BORDER }}>
          <Link to={actorHref(agentSlug, toAnchorId(cat.title))} className="mono text-[10px] uppercase tracking-wider hover:underline" style={{ color: "var(--tan)" }}>
            {title}
          </Link>
        </td>
      </tr>
      {cat.primitives.length === 0 ? (
        <tr style={{ background: ROW_COLORS[startIndex % 2] }}>
          <td className="mono text-[11px] py-0.5 pl-3" style={{ color: "var(--tan-3)", opacity: 0.5 }}>—</td>
          {HEADERS.map((h, i) => (
            <td key={i} className="mono text-[10px] py-0.5" style={tdStyle(h, true)} title={`0 ${h.full}`}>0</td>
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
    <article className="rounded py-4 break-inside-avoid" style={{ border: "1px solid var(--border)", background: "#0f0a08" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "auto" }} />
          {HEADERS.map((h) => <col key={h.key} style={{ width: h.key === "INV" ? "2rem" : "1.5rem" }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="text-left pb-2 pl-3" style={{ fontWeight: "600", fontSize: "0.875rem", color: "var(--tan)" }}>
              <Link to={actorHref(agent.slug)} className="hover:underline">{agent.name}</Link>
            </th>
            {HEADERS.map((h) => (
              <th key={h.key} className="mono text-[10px] pb-2" title={h.full} style={thStyle(h)}>{h.key}</th>
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

  return (
    <div className="flex-1 px-6 py-6 min-w-0">
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
