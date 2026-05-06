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
  const keyLabel = <span style={{ color: "var(--tan-3)" }}>{p.key}:</span>;
  if (isAddr) {
    const short = `${p.value.slice(0, 6)}…${p.value.slice(-4)}`;
    return (
      <span
        className="mono text-[11px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
        style={{ background: "var(--hover)", color: "var(--tan-2)" }}
      >
        {keyLabel}
        <a
          href={explorerUrl(p.value)}
          target="_blank"
          rel="noopener"
          className="text-accent hover:underline"
          title={p.value}
        >
          {short}
        </a>
      </span>
    );
  }
  return (
    <span
      className="mono text-[11px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
      style={{ background: "var(--hover)", color: "var(--tan-2)" }}
    >
      {keyLabel}
      {p.value}
    </span>
  );
}

const SEP = <span className="text-[10px]" style={{ color: "var(--tan-3)", opacity: 0.4 }}>|</span>;

function InstanceRow({
  inst,
  onNavigate,
}: {
  inst: RadarInstance;
  onNavigate: (id: string) => void;
}) {
  return (
    <div className="py-1.5 border-t border-[var(--border)]">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="text-sm" style={{ color: "var(--tan)" }}>
          {inst.displayName}
        </span>
        {inst.primitiveDocId && inst.primitiveTitle && (
          <>
            {SEP}
            <button
              onClick={() => onNavigate(inst.primitiveDocId!)}
              className="mono text-[10px] hover:underline"
              style={{ color: "var(--tan-3)" }}
            >
              {inst.primitiveTitle}
            </button>
          </>
        )}
        {inst.status && <>{SEP}<StatusPill s={inst.status} /></>}
      </div>
      {inst.signalParams.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {inst.signalParams.map((p) => (
            <ParamPill key={p.key} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  instances: RadarInstance[];
  onNavigate: (id: string) => void;
}

interface PrimitiveGroup {
  st: string;
  primitiveTitle: string | null;
  primitiveDocId: string | null;
  isUnknown: boolean;
  instances: RadarInstance[];
}

interface CategoryGroup {
  category: string;
  categoryDocId: string | null;
  primitives: PrimitiveGroup[];
}

function buildCategoryGroups(instances: RadarInstance[]): CategoryGroup[] {
  const catMap = new Map<string, { docId: string | null; primMap: Map<string, PrimitiveGroup> }>();
  for (const inst of instances) {
    const cat = inst.primitiveCategory ?? "Other";
    const catDocId = inst.primitiveCategoryDocId ?? null;
    if (!catMap.has(cat)) catMap.set(cat, { docId: catDocId, primMap: new Map() });
    const { primMap } = catMap.get(cat)!;
    if (!primMap.has(inst.st)) {
      primMap.set(inst.st, {
        st: inst.st,
        primitiveTitle: inst.primitiveTitle,
        primitiveDocId: inst.primitiveDocId,
        isUnknown: inst.isUnknownPrimitive,
        instances: [],
      });
    }
    primMap.get(inst.st)!.instances.push(inst);
  }
  return [...catMap.entries()].map(([category, { docId, primMap }]) => ({
    category,
    categoryDocId: docId,
    primitives: [...primMap.values()],
  }));
}

export function ActorInstances({ instances, onNavigate }: Props) {
  const groups = buildCategoryGroups(instances);

  return (
    <div className="space-y-6">
      {groups.map((cat) => (
        <div key={cat.category}>
          <div className="flex items-center gap-2 mb-3">
            {cat.categoryDocId ? (
              <button
                onClick={() => onNavigate(cat.categoryDocId!)}
                className="mono text-[11px] uppercase tracking-wider hover:underline"
                style={{ color: "var(--tan-3)" }}
              >
                {cat.category}
              </button>
            ) : (
              <span className="mono text-[11px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
                {cat.category}
              </span>
            )}
          </div>
          <div className="space-y-4 pl-3" style={{ borderLeft: "1px solid var(--border)" }}>
            {cat.primitives.map((prim) => (
              <div key={prim.st}>
                <div className="flex items-center gap-2 mb-1">
                  {prim.primitiveDocId ? (
                    <button
                      onClick={() => onNavigate(prim.primitiveDocId!)}
                      className="mono text-[11px] hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {prim.primitiveTitle ?? prim.st}
                    </button>
                  ) : (
                    <span className="mono text-[11px]" style={{ color: "var(--accent)" }}>
                      {prim.primitiveTitle ?? prim.st}
                    </span>
                  )}
                  <span className="mono text-[10px]" style={{ color: "var(--tan-3)", opacity: 0.6 }}>
                    ({prim.instances.length})
                  </span>
                  {prim.isUnknown && (
                    <span className="mono text-[10px] px-1 rounded" style={{ color: "var(--red)", border: "1px solid var(--red)" }} title="Not listed in Current Primitives (A.2.2.1.5.1)">
                      unknown
                    </span>
                  )}
                </div>
                {prim.instances.map((inst) => (
                  <InstanceRow key={inst.id} inst={inst} onNavigate={onNavigate} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
