import type { AddressInfo } from "../../types";
import type { AgentPrimitive, RewardsAgent, RewardsInstance } from "../../lib/rewardsIndex";
import { AddressLink, StatusPill } from "./RewardsCells";

function InstanceRow({ inst, kind, onNavigate, onEntity, addrMap }: {
  inst: RewardsInstance; kind: "DR" | "IB";
  onNavigate: (id: string) => void; onEntity: (slug: string) => void;
  addrMap: Record<string, AddressInfo>;
}) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
      <td className="py-2 px-3 align-top w-20"><StatusPill s={inst.status} /></td>
      <td className="py-2 px-3 align-top">
        <button onClick={() => onNavigate(inst.id)} className="text-sm text-tan hover:underline text-left">
          {inst.name}
        </button>
        <div className="mono text-[10px] text-tan-3 mt-0.5 flex items-center gap-2">
          <span>{inst.docNo}</span>
          {inst.params && Object.keys(inst.params).length > 0 && (
            <span className="opacity-70" title={Object.keys(inst.params).join(" · ")}>
              ⚙ {Object.keys(inst.params).length}
            </span>
          )}
        </div>
      </td>
      {kind === "DR" ? (
        <>
          <td className="py-2 px-3 align-top w-24 mono text-xs text-tan-2">
            {inst.rewardCode
              ? <button onClick={() => onNavigate(inst.rewardCodeDocId ?? inst.id)}
                  className="px-1.5 py-0.5 rounded bg-[var(--hover)] text-tan hover:underline">
                  {inst.rewardCode}
                </button>
              : <span className="text-tan-3">—</span>}
          </td>
          <td className="py-2 px-3 align-top text-xs text-tan-2">
            {inst.trackingDocId && inst.trackingDocNo
              ? <button onClick={() => onNavigate(inst.trackingDocId!)}
                  className="mono text-[11px] text-accent hover:underline">
                  {inst.trackingDocNo}
                </button>
              : <span className="text-tan-3">—</span>}
          </td>
          <td className="py-2 px-3 align-top w-32 text-[11px]">
            {inst.paymentsResponsibleParty
              ? <button onClick={() => onEntity(inst.paymentsResponsibleParty!.slug)}
                  className="text-accent hover:underline mono"
                  title={inst.paymentsControllerDocNo ? `owed on ${inst.paymentsControllerDocNo}` : undefined}>
                  {inst.paymentsResponsibleParty.name}
                </button>
              : <span className="text-tan-3">—</span>}
          </td>
        </>
      ) : (
        <>
          <td className="py-2 px-3 align-top text-xs text-tan-2">
            {inst.partnerName
              ? <button onClick={() => onNavigate(inst.partnerNameDocId ?? inst.id)}
                  className="text-tan-2 hover:underline text-left">
                  {inst.partnerName}
                </button>
              : <span className="text-tan-3">—</span>}
          </td>
          <td className="py-2 px-3 align-top text-xs">
            {inst.rewardAddress
              ? <AddressLink addr={inst.rewardAddress} chain={inst.rewardChain} addrMap={addrMap} />
              : <span className="text-tan-3">—</span>}
          </td>
          <td className="py-2 px-3 align-top mono text-[11px] w-28">
            {inst.rewardChain
              ? <button onClick={() => onNavigate(inst.rewardChainDocId ?? inst.id)}
                  className="text-tan-3 hover:underline">{inst.rewardChain}</button>
              : <span className="text-tan-3">—</span>}
          </td>
          <td className="py-2 px-3 align-top mono text-[11px] w-20">
            {inst.cadence
              ? <button onClick={() => onNavigate(inst.cadenceDocId ?? inst.id)}
                  className="text-tan-3 hover:underline">{inst.cadence}</button>
              : <span className="text-tan-3">—</span>}
          </td>
        </>
      )}
    </tr>
  );
}

export function PrimitiveTable({ agent, prim, onNavigate, onEntity, addrMap }: {
  agent: RewardsAgent; prim: AgentPrimitive; onNavigate: (id: string) => void;
  onEntity: (slug: string) => void; addrMap: Record<string, AddressInfo>;
}) {
  const all = [...prim.active, ...prim.completed, ...prim.inProgress];
  const kind = prim.kind;
  const title = kind === "DR" ? "Distribution Reward" : "Integration Boost";
  return (
    <div className="mb-6">
      <div className="flex items-baseline gap-3 mb-2">
        <h3 className="text-sm font-medium" style={{ color: "var(--tan)" }}>{title}</h3>
        <button onClick={() => onNavigate(prim.primitiveId)} className="mono text-[10px] text-accent hover:underline">
          {prim.primitiveDocNo}
        </button>
        <span className="mono text-[10px] text-tan-3">global: {prim.globalActivation ?? "—"}</span>
        <span className="mono text-[10px] text-tan-3">
          {prim.active.length} active · {prim.completed.length} completed · {prim.inProgress.length} in-progress
        </span>
      </div>
      {all.length === 0 ? (
        <p className="text-xs text-tan-3 italic px-3 py-2 rounded border border-[var(--border)] border-dashed">
          No instances yet. {agent.name} has {title} globally activated but has not invoked any instance.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] mono text-tan-3 border-b border-[var(--border)]">
                <th className="py-1.5 px-3 font-normal">Status</th>
                <th className="py-1.5 px-3 font-normal">Instance</th>
                {kind === "DR"
                  ? (<><th className="py-1.5 px-3 font-normal">Reward Code</th><th className="py-1.5 px-3 font-normal">Tracking</th><th className="py-1.5 px-3 font-normal">Payments RP</th></>)
                  : (<><th className="py-1.5 px-3 font-normal">Partner</th><th className="py-1.5 px-3 font-normal">Reward Address</th><th className="py-1.5 px-3 font-normal">Chain</th><th className="py-1.5 px-3 font-normal">Cadence</th></>)}
              </tr>
            </thead>
            <tbody>
              {all.map(inst => (
                <InstanceRow key={inst.id || inst.docNo} inst={inst} kind={kind}
                  onNavigate={onNavigate} onEntity={onEntity} addrMap={addrMap} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
