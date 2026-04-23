import type { RadarInstance, InstanceParam } from "../../lib/actorIndex";
import { StatusPill } from "../reports/RewardsCells";

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

function explorerUrl(val: string): string {
  if (SOL_RE.test(val)) return `https://solscan.io/account/${val}`;
  return `https://etherscan.io/address/${val}`;
}

function ParamPill({ p }: { p: InstanceParam }) {
  const isAddr = EVM_RE.test(p.value) || SOL_RE.test(p.value);
  if (isAddr) {
    const short = `${p.value.slice(0, 6)}…${p.value.slice(-4)}`;
    return (
      <a href={explorerUrl(p.value)} target="_blank" rel="noopener"
        className="mono text-[11px] text-accent hover:underline" title={p.value}>
        {short}
      </a>
    );
  }
  return (
    <span className="mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: "var(--hover)", color: "var(--tan-2)" }}>
      {p.value}
    </span>
  );
}

function InstanceRow({ inst, onNavigate }: { inst: RadarInstance; onNavigate: (id: string) => void }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-t border-[var(--border)]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm" style={{ color: "var(--tan)" }}>{inst.displayName}</span>
          {inst.signalParams.map(p => <ParamPill key={p.key} p={p} />)}
          {inst.status && <StatusPill s={inst.status} />}
        </div>
      </div>
      {inst.docId && (
        <button onClick={() => onNavigate(inst.docId!)}
          className="mono text-[10px] shrink-0 hover:underline" style={{ color: "var(--tan-3)" }}>
          {inst.docNo ?? "open"}
        </button>
      )}
    </div>
  );
}

interface Props { instances: RadarInstance[]; onNavigate: (id: string) => void; }

export function ActorInstances({ instances, onNavigate }: Props) {
  const byType = new Map<string, RadarInstance[]>();
  for (const inst of instances) {
    const g = byType.get(inst.st) ?? [];
    g.push(inst);
    byType.set(inst.st, g);
  }
  const groups = [...byType.entries()].sort(([a],[b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      {groups.map(([st, insts]) => (
        <div key={st}>
          <div className="flex items-center gap-2 mb-1">
            <span className="mono text-[11px]" style={{ color: "var(--tan-3)" }}>
              {st}
            </span>
            <span className="mono text-[10px]" style={{ color: "var(--tan-3)", opacity: 0.6 }}>
              ({insts.length})
            </span>
          </div>
          {insts.map(inst => <InstanceRow key={inst.id} inst={inst} onNavigate={onNavigate} />)}
        </div>
      ))}
    </div>
  );
}
