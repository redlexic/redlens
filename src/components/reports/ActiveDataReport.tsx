import { useState, useMemo, useEffect } from "react";
import { loadDocs } from "../../lib/docs";
import { loadGraph } from "../../lib/graph";
import { loadHistory } from "../../lib/history";
import { useLoaded } from "../../hooks/useAtlasData";
import {
  buildActiveDataRows,
  activeDataRowsToCSV,
  type ActiveDataRow,
  type EvidenceStep,
} from "../../lib/activeDataIndex";

type Row = ActiveDataRow;

function exportCSV(rows: Row[]) {
  const blob = new Blob([activeDataRowsToCSV(rows)], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: "active-data-index.csv",
  });
  a.click();
}

function EvidenceChain({
  title,
  steps,
  onNavigate,
}: {
  title: string;
  steps: EvidenceStep[];
  onNavigate: (id: string) => void;
}) {
  if (!steps.length) return null;
  return (
    <div className="mb-1 last:mb-0">
      <span className="mono text-[10px] text-tan-3">{title}: </span>
      {steps.map((s, i) => (
        <span key={i}>
          {i > 0 && <span className="text-tan-3 text-[10px]"> → </span>}
          {s.docId ? (
            <button
              onClick={() => onNavigate(s.docId!)}
              title={s.label}
              className="mono text-[10px] text-accent hover:underline"
            >
              {s.docNo}
            </button>
          ) : (
            <span className="mono text-[10px] text-tan-3" title={s.label}>
              {s.docNo}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function EvidenceCell({ r, onNavigate }: { r: Row; onNavigate: (id: string) => void }) {
  const rpSteps = r.responsibleParty?.evidence ?? [];
  const facSteps = r.facilitator?.evidence ?? [];
  if (!rpSteps.length && !facSteps.length) {
    return <span className="mono text-[10px] text-tan-3">—</span>;
  }
  return (
    <div>
      <EvidenceChain title="RP" steps={rpSteps} onNavigate={onNavigate} />
      <EvidenceChain title="Fac" steps={facSteps} onNavigate={onNavigate} />
    </div>
  );
}

export function ActiveDataReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  const docs = useLoaded(loadDocs);
  const graph = useLoaded(loadGraph);
  const rows = useMemo(
    () => (docs && graph ? buildActiveDataRows(docs, graph) : []),
    [docs, graph],
  );
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [lastEditDates, setLastEditDates] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!rows.length) return;
    let cancelled = false;
    Promise.all(
      rows.map((r) => loadHistory(r.activeDataId).then((h) => [r.activeDataId, h] as const)),
    ).then((pairs) => {
      if (cancelled) return;
      const m = new Map<string, string>();
      for (const [id, entries] of pairs) {
        if (entries?.length) m.set(id, entries[entries.length - 1].date);
      }
      setLastEditDates(m);
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  // Agents are derived from the rows themselves (graph-resolved in buildActiveDataRows).
  // Order by the first appearance of each agent — rows are pre-sorted by doc_no, which
  // keeps prime agents in their natural atlas order.
  const agents = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = ["Governance"];
    for (const r of rows) {
      const name = r.agent;
      if (name && !seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
    return ordered.filter((a) => (a === "Governance" ? rows.some((r) => r.agent === null) : true));
  }, [rows]);

  // Unique names for the Entity filter: responsible parties + facilitators.
  const entityNames = useMemo(() => {
    const names = new Set<string>();
    rows.forEach((r) => {
      if (r.responsibleParty?.name) names.add(r.responsibleParty.name);
      if (r.facilitator?.name) names.add(r.facilitator.name);
    });
    return [...names].sort();
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (agentFilter === "Governance" && r.agent !== null) return false;
        if (agentFilter && agentFilter !== "Governance" && r.agent !== agentFilter) return false;
        if (entityFilter) {
          const match =
            r.responsibleParty?.name === entityFilter || r.facilitator?.name === entityFilter;
          if (!match) return false;
        }
        return true;
      }),
    [rows, agentFilter, entityFilter],
  );

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Active Data Index
        </h1>
        <p className="text-sm text-tan-3 mb-5">
          All Active Data sections with full responsibility chain — sourced from the Atlas graph.{" "}
          <button
            className="text-accent hover:underline"
            onClick={() => onNavigate("75e8fd51-a540-4c3a-aaa9-1a38502f89b2")}
          >
            A.1.12 ↗
          </button>
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-tan-3">Scope:</span>
          {agents.map((a) => (
            <button
              key={a}
              onClick={() => setAgentFilter(agentFilter === a ? null : a)}
              data-active={agentFilter === a ? "true" : undefined}
              className="scope-pill mono text-xs px-2 py-0.5 rounded"
            >
              {a}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="text-xs text-tan-3">Entity:</span>
          {entityNames.map((e) => (
            <button
              key={e}
              onClick={() => setEntityFilter(entityFilter === e ? null : e)}
              data-active={entityFilter === e ? "true" : undefined}
              className="scope-pill mono text-xs px-2 py-0.5 rounded"
            >
              {e}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-tan-3">{filtered.length} sections</p>
          <button
            onClick={() => exportCSV(filtered)}
            className="mono text-xs px-3 py-1 rounded border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors"
          >
            Download CSV
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: "1120px" }}>
            <thead>
              <tr className="text-xs mono text-tan-3 border-b border-[var(--border)]">
                <th className="py-2 px-3 font-normal">AD Doc Title</th>
                <th className="py-2 px-3 font-normal w-40">Controller</th>
                <th className="py-2 px-3 font-normal w-24">Agent</th>
                <th className="py-2 px-3 font-normal w-44">Responsible Party</th>
                <th className="py-2 px-3 font-normal w-44">Facilitator</th>
                <th className="py-2 px-3 font-normal w-64">Evidence</th>
                <th className="py-2 px-3 font-normal w-32">Process</th>
                <th className="py-2 px-3 font-normal w-28">Last Edited</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.activeDataId}
                  className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors"
                >
                  <td className="py-2 px-3 align-top">
                    <button
                      onClick={() => onNavigate(r.activeDataId)}
                      className="text-sm text-tan hover:underline text-left block"
                    >
                      {r.activeDataTitle}
                    </button>
                    <span className="mono text-[10px] text-accent">{r.activeDataDocNo}</span>
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.controllerId && r.controllerDocNo ? (
                      <button
                        onClick={() => onNavigate(r.controllerId!)}
                        className="mono text-xs text-tan-2 hover:underline text-left"
                      >
                        {r.controllerDocNo}
                      </button>
                    ) : (
                      <span className="mono text-[10px] text-tan-3">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 align-top">
                    <span className="mono text-xs text-tan-3">{r.agent ?? "—"}</span>
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.responsibleParty ? (
                      r.responsibleParty.docId ? (
                        <button
                          onClick={() => onNavigate(r.responsibleParty!.docId!)}
                          className="text-xs text-tan-2 hover:text-tan hover:underline text-left"
                          title={r.responsibleParty.declared ?? undefined}
                        >
                          {r.responsibleParty.name}
                        </button>
                      ) : (
                        <span
                          className="text-xs text-tan-2"
                          title={r.responsibleParty.declared ?? undefined}
                        >
                          {r.responsibleParty.name}
                        </span>
                      )
                    ) : (
                      <span className="mono text-[10px] text-tan-3">Governance</span>
                    )}
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.facilitator ? (
                      r.facilitator.docId ? (
                        <button
                          onClick={() => onNavigate(r.facilitator!.docId!)}
                          className="text-xs text-tan-2 hover:text-tan hover:underline text-left"
                          title={r.facilitator.role}
                        >
                          {r.facilitator.name}
                        </button>
                      ) : (
                        <span className="text-xs text-tan-2" title={r.facilitator.role}>
                          {r.facilitator.name}
                        </span>
                      )
                    ) : (
                      <span className="mono text-[10px] text-tan-3">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 align-top">
                    <EvidenceCell r={r} onNavigate={onNavigate} />
                  </td>
                  <td className="py-2 px-3 align-top">
                    <span className="mono text-xs text-tan-3">{r.process}</span>
                  </td>
                  <td className="py-2 px-3 align-top">
                    <span className="mono text-xs text-tan-3">
                      {lastEditDates.get(r.activeDataId) ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
