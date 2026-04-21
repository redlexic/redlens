import { useState, useMemo, useEffect } from "react";
import { loadDocs } from "../../lib/docs";
import { loadGraph } from "../../lib/graph";
import {
  AGENT_PREFIXES, buildActiveDataRows, activeDataRowsToCSV,
  type ActiveDataRow,
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


export function ActiveDataReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadDocs(), loadGraph()]).then(([docs, graph]) => {
      setRows(buildActiveDataRows(docs, graph));
    });
  }, []);

  const agents = useMemo(() => {
    const set = new Set(rows.map(r => r.agent ?? "Governance"));
    return ["Governance", ...AGENT_PREFIXES.map(([, name]) => name)].filter(a => set.has(a));
  }, [rows]);

  // All unique editors: responsible party + facilitator + govops names.
  const entityNames = useMemo(() => {
    const names = new Set<string>();
    rows.forEach(r => {
      if (r.entityName && r.entityName !== "Governance") names.add(r.entityName);
      if (r.chain?.executorName) names.add(r.chain.executorName);
      if (r.chain?.facilitatorName) names.add(r.chain.facilitatorName);
      if (r.chain?.govopsName) names.add(r.chain.govopsName);
    });
    return [...names].sort();
  }, [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (agentFilter === "Governance" && r.agent !== null) return false;
    if (agentFilter && agentFilter !== "Governance" && r.agent !== agentFilter) return false;
    if (entityFilter) {
      const match =
        r.entityName === entityFilter ||
        r.chain?.executorName === entityFilter ||
        r.chain?.facilitatorName === entityFilter ||
        r.chain?.govopsName === entityFilter;
      if (!match) return false;
    }
    return true;
  }), [rows, agentFilter, entityFilter]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>Active Data Index</h1>
        <p className="text-sm text-tan-3 mb-5">
          All Active Data sections with full responsibility chain — sourced from the Atlas graph.{" "}
          <button className="text-accent hover:underline" onClick={() => onNavigate("75e8fd51-a540-4c3a-aaa9-1a38502f89b2")}>
            A.1.12 ↗
          </button>
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-tan-3">Scope:</span>
          {agents.map(a => (
            <button key={a} onClick={() => setAgentFilter(agentFilter === a ? null : a)}
              data-active={agentFilter === a ? "true" : undefined}
              className="scope-pill mono text-xs px-2 py-0.5 rounded">{a}</button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="text-xs text-tan-3">Editor:</span>
          {entityNames.map(e => (
            <button key={e} onClick={() => setEntityFilter(entityFilter === e ? null : e)}
              data-active={entityFilter === e ? "true" : undefined}
              className="scope-pill mono text-xs px-2 py-0.5 rounded">{e}</button>
          ))}
        </div>

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-tan-3">{filtered.length} sections</p>
          <button onClick={() => exportCSV(filtered)}
            className="mono text-xs px-3 py-1 rounded border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors">
            Download CSV
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: "960px" }}>
            <thead>
              <tr className="text-xs mono text-tan-3 border-b border-[var(--border)]">
                <th className="py-2 px-3 font-normal w-40">Active Data</th>
                <th className="py-2 px-3 font-normal">Title</th>
                <th className="py-2 px-3 font-normal w-40">Controller</th>
                <th className="py-2 px-3 font-normal w-24">Agent</th>
                <th className="py-2 px-3 font-normal w-36">OEA</th>
                <th className="py-2 px-3 font-normal w-36">Facilitator</th>
                <th className="py-2 px-3 font-normal w-36">GovOps</th>
                <th className="py-2 px-3 font-normal w-32">Process</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.activeDataId} className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
                  <td className="py-2 px-3 align-top">
                    <button onClick={() => onNavigate(r.activeDataId)}
                      className="mono text-xs text-accent hover:underline text-left">
                      {r.activeDataDocNo}
                    </button>
                  </td>
                  <td className="py-2 px-3 align-top">
                    <button onClick={() => onNavigate(r.activeDataId)}
                      className="text-sm text-tan hover:underline text-left">
                      {r.activeDataTitle}
                    </button>
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.controllerId && r.controllerDocNo ? (
                      <button onClick={() => onNavigate(r.controllerId!)}
                        className="mono text-xs text-tan-2 hover:underline text-left">
                        {r.controllerDocNo}
                      </button>
                    ) : <span className="mono text-[10px] text-tan-3">—</span>}
                  </td>
                  <td className="py-2 px-3 align-top">
                    <span className="mono text-xs text-tan-3">{r.agent ?? "—"}</span>
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.chain?.executorName ? (
                      <button onClick={() => r.chain?.executorId && onNavigate(r.chain.executorId)}
                        className="text-xs text-tan-2 hover:text-tan hover:underline text-left">
                        {r.chain.executorName}
                      </button>
                    ) : <span className="mono text-[10px] text-tan-3">—</span>}
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.chain?.facilitatorName ? (
                      <button onClick={() => r.chain?.facilitatorId && onNavigate(r.chain.facilitatorId)}
                        className="text-xs text-tan-2 hover:text-tan hover:underline text-left">
                        {r.chain.facilitatorName}
                      </button>
                    ) : <span className="mono text-[10px] text-tan-3">—</span>}
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.chain?.govopsName ? (
                      <button onClick={() => r.chain?.govopsId && onNavigate(r.chain.govopsId)}
                        className="text-xs text-tan-2 hover:text-tan hover:underline text-left">
                        {r.chain.govopsName}
                      </button>
                    ) : <span className="mono text-[10px] text-tan-3">—</span>}
                  </td>
                  <td className="py-2 px-3 align-top">
                    <span className="mono text-xs text-tan-3">{r.process}</span>
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
