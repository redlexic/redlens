import { useState, useMemo } from "react";
import { loadGraph } from "../../lib/graph";
import { loadAtlas } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import type { GraphEntity } from "../../types";
import {
  CATEGORY_LABELS,
  type OFResponsibility,
  deriveResponsibilities,
} from "../../lib/facilitatorResponsibilities";

type ActiveFilter =
  | { kind: "core" }
  | { kind: "facilitator"; name: string }
  | { kind: "executor"; name: string }
  | { kind: "agent"; name: string }
  | null;

interface AgentChain {
  agentName: string;
  agentId: string;
  executorName: string;
  executorId: string;
  facilitatorName: string;
  facilitatorId: string;
  govopsName: string;
  govopsId: string;
}

function Row({
  r,
  chains,
  onNavigate,
}: {
  r: OFResponsibility;
  chains: Map<string, AgentChain>;
  onNavigate: (id: string) => void;
}) {
  const agentNames = useMemo(
    () => r.agents ?? (r.agent ? [r.agent] : []),
    [r.agents, r.agent],
  );

  const facilitators = useMemo(() => {
    const seen = new Map<string, AgentChain>();
    for (const a of agentNames) {
      const c = chains.get(a);
      if (c && !seen.has(c.facilitatorId)) seen.set(c.facilitatorId, c);
    }
    return [...seen.values()];
  }, [agentNames, chains]);

  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
      <td className="py-2 px-3 align-top">
        <button
          onClick={() => r.uuid && onNavigate(r.uuid)}
          disabled={!r.uuid}
          className="mono text-xs text-accent hover:underline disabled:text-tan-3 disabled:no-underline text-left"
        >
          {r.docNo}
        </button>
      </td>
      <td className="py-2 px-3 align-top text-sm text-tan">{r.title}</td>
      <td className="py-2 px-3 align-top text-sm text-tan-2">{r.duty}</td>
      <td className="py-2 px-3 align-top">
        {agentNames.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {agentNames.map((a) => {
              const c = chains.get(a);
              return (
                <button
                  key={a}
                  onClick={() => c && onNavigate(c.agentId)}
                  className="mono text-xs px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors"
                >
                  {a}
                </button>
              );
            })}
          </div>
        ) : null}
      </td>
      <td className="py-2 px-3 align-top">
        {facilitators.map((c) => (
          <div key={c.facilitatorId} className="flex items-center gap-1.5 mb-0.5">
            <button
              onClick={() => onNavigate(c.executorId)}
              className="mono text-[10px] text-tan-3 hover:text-tan hover:underline"
            >
              {c.executorName}
            </button>
            <span className="text-tan-3 text-[10px]">/</span>
            <button
              onClick={() => onNavigate(c.facilitatorId)}
              className="text-xs text-accent hover:underline"
            >
              {c.facilitatorName}
            </button>
          </div>
        ))}
      </td>
    </tr>
  );
}

export function OFReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  const graphData = useLoaded(loadGraph);
  const atlas = useLoaded(loadAtlas);
  const [filter, setFilter] = useState<ActiveFilter>(null);

  const chains = useMemo<Map<string, AgentChain>>(() => {
    if (!graphData) return new Map();
    const { participants, edges } = graphData;
    const entityById = new Map<string, GraphEntity>(participants.map((e) => [e.id, e]));
    const execAgentEdges = edges.filter((e) => e.e === "operational_executor_agent_for");
    const facEdges = edges.filter((e) => e.e === "operational_facilitator_for");
    const govEdges = edges.filter((e) => e.e === "operational_govops_for");
    const primes = participants.filter((e) => e.et === "agent" && e.st === "prime");
    const map = new Map<string, AgentChain>();
    for (const prime of primes) {
      const execEdge = execAgentEdges.find((e) => e.t === prime.id);
      const executor = execEdge ? entityById.get(execEdge.f) : null;
      if (!executor) continue;
      const facEdge = facEdges.find((e) => e.t === executor.id);
      const govEdge = govEdges.find((e) => e.t === executor.id);
      const fac = facEdge ? entityById.get(facEdge.f) : null;
      const gov = govEdge ? entityById.get(govEdge.f) : null;
      if (!fac) continue;
      map.set(prime.name, {
        agentName: prime.name,
        agentId: prime.id,
        executorName: executor.name.replace(/^(Operational|Core Council) Executor Agent\s+/i, ""),
        executorId: executor.id,
        facilitatorName: fac.name,
        facilitatorId: fac.id,
        govopsName: gov?.name ?? "",
        govopsId: gov?.id ?? "",
      });
    }
    return map;
  }, [graphData]);

  const responsibilities = useMemo(
    () => (atlas && graphData ? deriveResponsibilities(atlas, graphData) : []),
    [atlas, graphData],
  );

  const allAgents = useMemo(
    () => [...new Set(responsibilities.flatMap((r) => r.agents ?? (r.agent ? [r.agent] : [])))],
    [responsibilities],
  );

  const facilitators = useMemo(() => {
    const seen = new Map<string, string>();
    for (const [, c] of chains) {
      if (!seen.has(c.facilitatorId)) seen.set(c.facilitatorId, c.facilitatorName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [chains]);

  const executors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const [, c] of chains) {
      if (!seen.has(c.executorId)) seen.set(c.executorId, c.executorName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [chains]);

  const coreFacilitator = useMemo(() => {
    if (!graphData) return null;
    const edge = graphData.edges.find((e) => e.e === "core_facilitator_for");
    return edge ? (graphData.participants.find((p) => p.id === edge.f) ?? null) : null;
  }, [graphData]);

  const toggle = (next: ActiveFilter) =>
    setFilter((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? null : next));

  const filtered = responsibilities.flatMap((r) => {
    const expanded: OFResponsibility[] = r.agents
      ? r.agents.map((a) => ({ ...r, agents: undefined, agent: a }))
      : [r];
    return expanded.filter((row) => {
      const isCF = row.category === "core-facilitator";
      if (filter?.kind === "core") return isCF;
      if (isCF) return filter === null;
      const agentNames = row.agent ? [row.agent] : [];
      if (filter?.kind === "agent") return agentNames.includes(filter.name);
      if (filter?.kind === "executor")
        return agentNames.some((a) => chains.get(a)?.executorName === filter.name);
      if (filter?.kind === "facilitator")
        return agentNames.some((a) => chains.get(a)?.facilitatorName === filter.name);
      return true;
    });
  });

  const byCategory = Object.groupBy(filtered, (r) => r.category) as Record<
    OFResponsibility["category"],
    OFResponsibility[]
  >;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-5xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Operational Facilitator Responsibilities
        </h1>
        <p className="text-sm text-tan-3 mb-5">
          Every Atlas section mandating action from an Operational Facilitator.{" "}
          <button
            className="text-accent hover:underline"
            onClick={() => onNavigate("1ce24b08-84ff-4524-9710-49bba429c6ef")}
          >
            A.1.6 Facilitators ↗
          </button>
        </p>

        <div className="flex flex-wrap gap-4 mb-6">
          {coreFacilitator && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-tan-3 mr-1">Core:</span>
              <button
                onClick={() => toggle({ kind: "core" })}
                data-active={filter?.kind === "core" ? "true" : undefined}
                className="scope-pill text-xs px-2 py-0.5 rounded"
              >
                {coreFacilitator.name}
              </button>
            </div>
          )}
          {facilitators.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-tan-3 mr-1">Facilitator:</span>
              {facilitators.map((f) => (
                <button
                  key={f.id}
                  onClick={() => toggle({ kind: "facilitator", name: f.name })}
                  data-active={filter?.kind === "facilitator" && filter.name === f.name ? "true" : undefined}
                  className="scope-pill text-xs px-2 py-0.5 rounded"
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
          {executors.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-tan-3 mr-1">Executor:</span>
              {executors.map((e) => (
                <button
                  key={e.id}
                  onClick={() => toggle({ kind: "executor", name: e.name })}
                  data-active={filter?.kind === "executor" && filter.name === e.name ? "true" : undefined}
                  className="scope-pill text-xs px-2 py-0.5 rounded"
                >
                  {e.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-tan-3 mr-1">Prime:</span>
            {allAgents.map((a) => (
              <button
                key={a}
                onClick={() => toggle({ kind: "agent", name: a })}
                data-active={filter?.kind === "agent" && filter.name === a ? "true" : undefined}
                className="scope-pill mono text-xs px-2 py-0.5 rounded"
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {(Object.entries(CATEGORY_LABELS) as [OFResponsibility["category"], string][]).map(
          ([cat, label]) => {
            const rows = byCategory[cat];
            if (!rows?.length) return null;
            if (cat === "universal" || cat === "core-facilitator") {
              return (
                <div key={cat} className="mb-8">
                  <div className="flex items-center gap-3 mb-3 pb-1 border-b border-[var(--border)]">
                    <h2 className="text-xs mono text-tan-3 uppercase tracking-wider flex-1">{label}</h2>
                    {cat === "core-facilitator" && coreFacilitator?.did && (
                      <button onClick={() => onNavigate(coreFacilitator.did!)} className="text-xs text-accent hover:underline">
                        {coreFacilitator.name} ↗
                      </button>
                    )}
                  </div>
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-xs mono text-tan-3">
                        <th className="py-1 px-3 font-normal w-44">Doc</th>
                        <th className="py-1 px-3 font-normal">Section</th>
                        <th className="py-1 px-3 font-normal">Duty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.docNo} className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
                          <td className="py-2 px-3 align-top">
                            <button onClick={() => r.uuid && onNavigate(r.uuid)} disabled={!r.uuid}
                              className="mono text-xs text-accent hover:underline disabled:text-tan-3 disabled:no-underline text-left">
                              {r.docNo}
                            </button>
                          </td>
                          <td className="py-2 px-3 align-top text-sm text-tan">{r.title}</td>
                          <td className="py-2 px-3 align-top text-sm text-tan-2">{r.duty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
            return (
              <div key={cat} className="mb-8">
                <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">
                  {label}
                </h2>
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs mono text-tan-3">
                      <th className="py-1 px-3 font-normal w-44">Doc</th>
                      <th className="py-1 px-3 font-normal">Section</th>
                      <th className="py-1 px-3 font-normal">Duty</th>
                      <th className="py-1 px-3 font-normal w-36">Prime</th>
                      <th className="py-1 px-3 font-normal w-48">OEA / Facilitator</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <Row key={r.docNo} r={r} chains={chains} onNavigate={onNavigate} />
                    ))}
                  </tbody>
                </table>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}
