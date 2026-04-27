import { ENTITY_TYPE_COLOR } from "../../lib/entityGraph";
import type { ActorChain, ChainNode } from "../../lib/actorIndex";

interface Props {
  chain: ActorChain;
  currentSlug: string;
  onActor: (slug: string) => void;
  onNavigate: (id: string) => void;
}

function ChainBox({
  node,
  isCurrent,
  onActor,
  onNavigate,
}: {
  node: ChainNode;
  isCurrent: boolean;
  onActor: (slug: string) => void;
  onNavigate: (id: string) => void;
}) {
  const color = ENTITY_TYPE_COLOR[node.et] ?? "#888";
  return (
    <button
      onClick={() => (isCurrent ? node.docId && onNavigate(node.docId) : onActor(node.slug))}
      title={isCurrent ? "Open in Atlas" : `View ${node.name}`}
      className="chain-box px-2 py-1 rounded text-xs mono text-left"
      style={{
        border: `1px solid ${isCurrent ? color : "var(--border)"}`,
        color: isCurrent ? color : "var(--tan-2)",
        background: isCurrent ? `color-mix(in srgb, ${color} 10%, transparent)` : "transparent",
      }}
    >
      {node.name}
    </button>
  );
}

export function ActorChain({ chain, currentSlug, onActor, onNavigate }: Props) {
  const { prime, executors, facilitators, govops } = chain;
  const isCurrent = (n: ChainNode) => n.slug === currentSlug;

  return (
    <div
      className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs mono py-3 border-b border-[var(--border)]"
      style={{ color: "var(--tan-3)" }}
    >
      {prime ? (
        <ChainBox
          node={prime}
          isCurrent={isCurrent(prime)}
          onActor={onActor}
          onNavigate={onNavigate}
        />
      ) : (
        <span className="text-tan-3">—</span>
      )}

      <span>/</span>

      {executors.length > 0 ? (
        executors.map((ex) => (
          <ChainBox
            key={ex.id}
            node={ex}
            isCurrent={isCurrent(ex)}
            onActor={onActor}
            onNavigate={onNavigate}
          />
        ))
      ) : (
        <span className="text-tan-3">—</span>
      )}

      <span>/</span>

      <div className="flex flex-wrap gap-1">
        {facilitators.length > 0 ? (
          facilitators.map((f) => (
            <ChainBox
              key={f.id}
              node={f}
              isCurrent={isCurrent(f)}
              onActor={onActor}
              onNavigate={onNavigate}
            />
          ))
        ) : (
          <span className="text-tan-3">—</span>
        )}
        {govops.map((g) => (
          <ChainBox
            key={g.id}
            node={g}
            isCurrent={isCurrent(g)}
            onActor={onActor}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}
