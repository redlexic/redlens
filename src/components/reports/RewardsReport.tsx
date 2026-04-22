import { useState, useEffect, useMemo } from "react";
import { loadDocs } from "../../lib/docs";
import { loadAddresses } from "../../lib/addresses";
import { loadGraph } from "../../lib/graph";
import type { AddressInfo } from "../../types";
import { buildRewardsIndex, type RewardsIndex, type RewardsAgent } from "../../lib/rewardsIndex";
import { AddressLink, EntityChip } from "./RewardsCells";
import { PrimitiveTable } from "./RewardsPrimitiveTable";

function EcosystemHeader({ idx, onNavigate, addrMap }: {
  idx: RewardsIndex; onNavigate: (id: string) => void; addrMap: Record<string, AddressInfo>;
}) {
  const cards = (["drPrimitive", "ibPrimitive", "stUsdsDr", "srUsdsDr"] as const)
    .map(k => idx[k]).filter((n): n is NonNullable<typeof n> => !!n);
  return (
    <div className="mb-8 grid md:grid-cols-2 gap-4">
      {cards.map(n => (
        <button key={n.id} onClick={() => onNavigate(n.id)}
          className="text-left p-3 rounded border border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-sm font-medium text-tan">{n.title}</span>
            <span className="mono text-[10px] text-accent">{n.docNo}</span>
          </div>
          <p className="text-[11px] text-tan-3 line-clamp-2">{n.description}</p>
        </button>
      ))}
      <div className="md:col-span-2 text-[11px] text-tan-3 flex items-center gap-2 pt-2">
        <span>Demand Side Buffer Multisig:</span>
        <AddressLink addr={idx.demandSideBufferAddress} chain="ethereum" addrMap={addrMap} />
        <span className="opacity-60">— DR + IB disbursement account</span>
      </div>
    </div>
  );
}

function AgentSection({ agent, onNavigate, onEntity, addrMap }: {
  agent: RewardsAgent; onNavigate: (id: string) => void; onEntity: (slug: string) => void;
  addrMap: Record<string, AddressInfo>;
}) {
  const drCount = agent.dr ? agent.dr.active.length + agent.dr.completed.length + agent.dr.inProgress.length : 0;
  const ibCount = agent.ib ? agent.ib.active.length + agent.ib.completed.length + agent.ib.inProgress.length : 0;
  const chain = agent.chain;
  return (
    <section className="mb-10 pb-8 border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="text-lg font-semibold" style={{ color: "var(--tan)" }}>{agent.name}</h2>
        {drCount + ibCount === 0 && <span className="mono text-[10px] text-tan-3">(no instances)</span>}
      </div>
      {chain && (chain.executor || chain.govops) && (
        <p className="text-[11px] text-tan-3 mb-4 flex items-center gap-2 flex-wrap">
          {chain.executor && <>calculated by <EntityChip e={chain.executor} onEntity={onEntity} /></>}
          {chain.executor && chain.govops && <span className="opacity-50">·</span>}
          {chain.govops && <>disbursed by <EntityChip e={chain.govops} onEntity={onEntity} /></>}
        </p>
      )}
      {agent.dr && <PrimitiveTable agent={agent} prim={agent.dr} onNavigate={onNavigate} onEntity={onEntity} addrMap={addrMap} />}
      {agent.ib && <PrimitiveTable agent={agent} prim={agent.ib} onNavigate={onNavigate} onEntity={onEntity} addrMap={addrMap} />}
    </section>
  );
}

export function RewardsReport({ onNavigate, onEntity }: {
  onNavigate: (id: string) => void; onEntity: (slug: string) => void;
}) {
  const [idx, setIdx] = useState<RewardsIndex | null>(null);
  const [addrMap, setAddrMap] = useState<Record<string, AddressInfo>>({});

  useEffect(() => {
    Promise.all([loadDocs(), loadAddresses(), loadGraph()]).then(([docs, addrs, graph]) => {
      setIdx(buildRewardsIndex(docs, graph));
      setAddrMap(addrs);
    });
  }, []);

  const summary = useMemo(() => {
    if (!idx) return null;
    const agg = { dr: 0, ib: 0, codes: 0, addrs: 0 };
    for (const a of idx.agents) {
      if (a.dr) {
        agg.dr += a.dr.active.length + a.dr.completed.length + a.dr.inProgress.length;
        for (const i of [...a.dr.active, ...a.dr.completed, ...a.dr.inProgress]) if (i.rewardCode) agg.codes++;
      }
      if (a.ib) {
        agg.ib += a.ib.active.length + a.ib.completed.length + a.ib.inProgress.length;
        for (const i of [...a.ib.active, ...a.ib.completed, ...a.ib.inProgress]) if (i.rewardAddress) agg.addrs++;
      }
    }
    return agg;
  }, [idx]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-6xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>Distribution Reward Relationships</h1>
        <p className="text-sm text-tan-3 mb-6">
          Every Distribution Reward and Integration Boost instance each Prime Agent has invoked, with reward codes, partner names, and on-chain reward addresses — sourced from the Atlas.
          {summary && <span className="mono text-[11px] ml-2">{summary.dr} DR · {summary.ib} IB · {summary.codes} codes · {summary.addrs} addresses</span>}
        </p>

        {!idx ? <p className="text-sm text-tan-3">Loading…</p> : (
          <>
            <EcosystemHeader idx={idx} onNavigate={onNavigate} addrMap={addrMap} />
            {idx.agents.map(a =>
              <AgentSection key={a.name} agent={a} onNavigate={onNavigate} onEntity={onEntity} addrMap={addrMap} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
