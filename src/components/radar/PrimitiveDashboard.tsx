import { Link } from "../Link";
import { Tooltip } from "../Tooltip";
import type { AgentPrimitiveStat, CategoryStat, PrimitiveStat } from "../../lib/primitiveStats";
import { toAnchorId } from "../../lib/anchorId";
import { actorHref } from "../../lib/routes";
import { useUrlState, urlString } from "../../hooks/useUrlState";

const execCodec = urlString(null);

function shortenCategoryTitle(title: string): string {
  return title.replace(/\s*Primitives\s*/i, "").trim();
}

// Instances (A/S/C) and Invocations are atlas-distinct concepts (A.2.2.1.3 vs
// A.2.2.1.4). Invocations sit in the leftmost column; the Active column carries
// the thick group divider so the boundary between the two concepts reads
// visually. `isGroupStart` drives the divider; `group` drives anchor routing.
const HEADERS = [
  { key: "Inv", full: "Invocations", label: "Invocations", group: "invocation" as const, isGroupStart: false },
  { key: "Act", full: "Active",     label: "Active Instances",    group: "instance" as const, isGroupStart: true },
  { key: "Sus", full: "Suspended",  label: "Suspended Instances", group: "instance" as const, isGroupStart: false },
  { key: "Com", full: "Completed",  label: "Completed Instances", group: "instance" as const, isGroupStart: false },
];

function namesFor(p: PrimitiveStat, i: number): string[] {
  return [p.invocationNames, p.activeNames, p.suspendedNames, p.completedNames][i];
}

function NameList({ names }: { names: string[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {names.map((n, i) => (
        <li key={i} style={{ whiteSpace: "nowrap" }}>{n}</li>
      ))}
    </ul>
  );
}

interface NameGroup { primTitle: string; names: string[] }

function GroupedNameList({ groups }: { groups: NameGroup[] }) {
  return (
    <div>
      {groups.map((g, gi) => (
        <div key={gi} style={{ marginTop: gi === 0 ? 0 : 6 }}>
          <div className="mono" style={{ color: "var(--tan-3)", textTransform: "uppercase", fontSize: 9, letterSpacing: "0.05em", marginBottom: 1 }}>
            {g.primTitle}
          </div>
          <NameList names={g.names} />
        </div>
      ))}
    </div>
  );
}

const BORDER = "1px solid #4e3a35";
const GROUP_BORDER = "2px solid #6b4a40";

const cellPadding = "0.175rem"

function thStyle(h: typeof HEADERS[number]): React.CSSProperties {
  return {
    width: "2rem",
    textAlign: "center",
    borderLeft: h.isGroupStart ? GROUP_BORDER : BORDER,
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
    borderLeft: h.isGroupStart ? GROUP_BORDER : BORDER,
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
        <Tooltip content={`${p.title} Primitive`}>
          <Link to={actorHref(agentSlug, p.st)} className="mono text-[11px] hover:underline w-full text-left truncate block" style={{ color: "var(--tan-2)" }}>
            {p.title}
          </Link>
        </Tooltip>
      </td>
      {[p.invocations, p.active, p.suspended, p.completed].map((n, i) => {
        const h = HEADERS[i];
        const style = tdStyle(h, n === 0);
        const names = namesFor(p, i);
        const tip = n === 0 ? `No ${h.label}` : <NameList names={names} />;
        if (n === 0) {
          return (
            <Tooltip key={i} content={tip}>
              <td className="mono text-[10px] py-0.5" style={style}>{n}</td>
            </Tooltip>
          );
        }
        return (
          <Tooltip key={i} content={tip}>
            <td className="mono text-[10px] py-0.5" style={style}>
              <Link to={actorHref(agentSlug, anchorFor(h, p.st))} className="hover:underline" style={{ color: "inherit" }}>
                {n}
              </Link>
            </td>
          </Tooltip>
        );
      })}
    </tr>
  );
}

function CategoryRows({ cat, startIndex, agentSlug }: { cat: CategoryStat; startIndex: number; agentSlug: string }) {
  const title = shortenCategoryTitle(cat.title);
  const sums = cat.primitives.reduce(
    (acc, p) => {
      acc[0] += p.invocations;
      acc[1] += p.active;
      acc[2] += p.suspended;
      acc[3] += p.completed;
      return acc;
    },
    [0, 0, 0, 0],
  );
  return (
    <>
      <tr style={{ fontWeight: "bold" }}>
        <td className="pt-3 pb-0.5 pl-3" style={{ borderBottom: BORDER }}>
          <Tooltip content={cat.title}>
            <Link to={actorHref(agentSlug, toAnchorId(cat.title))} className="mono text-[10px] uppercase tracking-wider hover:underline" style={{ color: "var(--lily-green)" }}>
              {title}
            </Link>
          </Tooltip>
        </td>
        {HEADERS.map((h, i) => {
          const sum = sums[i];
          const groups: NameGroup[] = cat.primitives
            .map((p) => ({ primTitle: p.title, names: namesFor(p, i) }))
            .filter((g) => g.names.length > 0);
          const tip = sum === 0
            ? `No ${h.label} in ${cat.title}`
            : <GroupedNameList groups={groups} />;
          const cellStyle: React.CSSProperties = {
            textAlign: "center",
            borderLeft: h.isGroupStart ? GROUP_BORDER : BORDER,
            borderBottom: BORDER,
            paddingLeft: cellPadding,
            paddingRight: cellPadding,
            color: "var(--terminal-green)",
            opacity: sum === 0 ? 0.3 : 1,
          };
          return (
            <Tooltip key={h.key} content={tip}>
              <td className="mono text-[10px] pt-3 pb-0.5" style={cellStyle}>
                {sum === 0 ? (
                  sum
                ) : (
                  <Link to={actorHref(agentSlug, toAnchorId(cat.title))} className="hover:underline" style={{ color: "inherit" }}>
                    {sum}
                  </Link>
                )}
              </td>
            </Tooltip>
          );
        })}
      </tr>
      {cat.primitives.length === 0 ? (
        <tr style={{ background: ROW_COLORS[startIndex % 2] }}>
          <td className="mono text-[11px] py-0.5 pl-3" style={{ color: "var(--tan-3)", opacity: 0.5 }}>—</td>
          {HEADERS.map((h, i) => (
            <Tooltip key={i} content={`No ${h.label}`}>
              <td className="mono text-[10px] py-0.5" style={tdStyle(h, true)}>0</td>
            </Tooltip>
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
  const totals = agent.categories.reduce(
    (acc, cat) => {
      for (const p of cat.primitives) {
        acc[0] += p.invocations;
        acc[1] += p.active;
        acc[2] += p.suspended;
        acc[3] += p.completed;
      }
      return acc;
    },
    [0, 0, 0, 0],
  );
  const instanceTotal = totals[1] + totals[2] + totals[3];
  const agentTip = (
    <div>
      <div style={{ fontWeight: 600 }}>{agent.name} Prime Agent</div>
      <div style={{ color: "var(--tan-2)" }}>{instanceTotal} Total Instances</div>
    </div>
  );
  return (
    <article className="rounded py-4 break-inside-avoid" style={{ border: "1px solid var(--border)", background: "#0f0a08" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "auto" }} />
          {HEADERS.map((h) => <col key={h.key} style={{ width: "2rem" }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="text-left pb-2 pl-3" style={{ fontWeight: "600", fontSize: "0.875rem", color: "var(--tan)" }}>
              <Tooltip content={agentTip}>
                <Link to={actorHref(agent.slug)} className="hover:underline">{agent.name}</Link>
              </Tooltip>
            </th>
            {HEADERS.map((h, i) => (
              <Tooltip key={h.key} content={`${totals[i]} ${h.label}`}>
                <th className="mono text-[10px] pb-2" style={thStyle(h)}>{h.key}</th>
              </Tooltip>
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
