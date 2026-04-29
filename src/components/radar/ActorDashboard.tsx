import type { ActorProfile, ActorRelation, Recommendation } from "../../lib/actorIndex";
import { ENTITY_TYPE_LABEL, ENTITY_TYPE_COLOR, edgeLabel } from "../../lib/entityGraph";
import { ActorChain } from "./ActorChain";
import { ActorResponsibilities } from "./ActorResponsibilities";
import { ActorRewards } from "./ActorRewards";
import { ActorInstances } from "./ActorInstances";
import { Link } from "wouter";

interface Props {
  profile: ActorProfile;
  onNavigate: (id: string) => void;
  onActor: (slug: string) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2
        className="mono text-[10px] uppercase tracking-wider mb-3"
        style={{ color: "var(--tan-3)" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function RelationRow({ r, onActor }: { r: ActorRelation; onActor: (slug: string) => void }) {
  const label = edgeLabel(r.edge.e, r.direction);
  const arrow = r.direction === "outbound" ? "→" : "←";
  return (
    <div className="flex items-center gap-2 py-1 border-t border-[var(--border)] text-sm">
      <span className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        {arrow} {label}
      </span>
      {r.otherSlug ? (
        <button onClick={() => onActor(r.otherSlug!)} className="text-accent hover:underline">
          {r.otherLabel}
        </button>
      ) : (
        <span style={{ color: "var(--tan-2)" }}>{r.otherLabel}</span>
      )}
    </div>
  );
}

function RecRow({ rec, onActor }: { rec: Recommendation; onActor: (slug: string) => void }) {
  return (
    <div className="flex items-start gap-2 py-1 border-t border-[var(--border)] text-sm">
      <span style={{ color: "var(--accent)" }}>▲</span>
      <div>
        <span style={{ color: "var(--tan-2)" }}>{rec.label}</span>
        {rec.reportLink && (
          <Link to={rec.reportLink} className="mono text-[10px] text-accent hover:underline ml-2">
            view report →
          </Link>
        )}
        {rec.entityLink && (
          <button
            onClick={() => onActor(rec.entityLink!)}
            className="mono text-[10px] text-accent hover:underline ml-2"
          >
            view actor →
          </button>
        )}
        <div className="text-xs mt-0.5" style={{ color: "var(--tan-3)" }}>
          {rec.detail}
        </div>
      </div>
    </div>
  );
}

export function ActorDashboard({ profile, onNavigate, onActor }: Props) {
  const {
    entity,
    definingDoc,
    chain,
    adRows,
    rewardsAgent,
    relations,
    instances,
    recommendations,
    comprisesMembers,
    partOfComposite,
  } = profile;
  const color = ENTITY_TYPE_COLOR[entity.et] ?? "#888";
  const typeLabel =
    entity.et === "agent"
      ? entity.st === "prime"
        ? "Prime Agent"
        : "Executor Agent"
      : (ENTITY_TYPE_LABEL[entity.et] ?? entity.et);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-start gap-3 mb-6">
          <div className="flex-1">
            <p className="mono text-xs mb-1" style={{ color: "var(--tan-3)" }}>
              radar
            </p>
            <h1 className="text-xl font-semibold" style={{ color: "var(--tan)" }}>
              {entity.name}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="mono text-[11px] px-1.5 py-0.5 rounded"
                style={{ border: `1px solid ${color}`, color }}
              >
                {typeLabel}
              </span>
              {definingDoc && (
                <button
                  onClick={() => onNavigate(definingDoc.id)}
                  className="mono text-[10px] text-accent hover:underline"
                >
                  {definingDoc.doc_no} →
                </button>
              )}
              {partOfComposite?.slug && (
                <button
                  onClick={() => onActor(partOfComposite.slug!)}
                  className="mono text-[10px] text-tan-3 hover:text-accent hover:underline"
                >
                  part of {partOfComposite.name} →
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Chain — always shown */}
        <div className="mb-6">
          <ActorChain
            chain={chain}
            currentSlug={entity.slug}
            onActor={onActor}
            onNavigate={onNavigate}
          />
        </div>

        {entity.et === "composite_party" && (
          <Section title="Composite Party">
            <p className="text-sm mb-3" style={{ color: "var(--tan-2)" }}>
              A composite party is the named legal counterparty in a Sky{" "}
              <button onClick={() => onNavigate("104c3543-ce94-4a2f-9968-57f1ee858085")} className="text-accent hover:underline">
                Ecosystem Accord
              </button>
              {" "}— an agreement between Sky Ecosystem actors that is enforceable by Sky Governance. It may comprise the Prime Agent and associated legal entities (foundation, development company) acting together as a single party to the accord.
            </p>
            {comprisesMembers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {comprisesMembers.map((m) =>
                  m.slug ? (
                    <button key={m.slug} onClick={() => onActor(m.slug!)}
                      className="text-xs px-2 py-0.5 rounded border border-[var(--border)] text-accent hover:border-[var(--accent)] transition-colors">
                      {m.name}
                    </button>
                  ) : (
                    <span key={m.name} className="text-xs px-2 py-0.5 rounded border border-[var(--border)] text-tan-2">
                      {m.name}
                    </span>
                  )
                )}
              </div>
            )}
          </Section>
        )}
        {adRows.length > 0 && (
          <Section title="Responsibilities">
            <ActorResponsibilities rows={adRows} onNavigate={onNavigate} />
          </Section>
        )}
        {rewardsAgent && (
          <Section title="Rewards">
            <ActorRewards agent={rewardsAgent} onNavigate={onNavigate} onActor={onActor} />
          </Section>
        )}
        {instances.length > 0 && (
          <Section title="Instances">
            <ActorInstances instances={instances} onNavigate={onNavigate} />
          </Section>
        )}
        {relations.length > 0 && (
          <Section title="Relationships">
            {relations.map((r, i) => (
              <RelationRow key={i} r={r} onActor={onActor} />
            ))}
          </Section>
        )}
        {recommendations.length > 0 && (
          <Section title="Notable">
            {recommendations.map((rec, i) => (
              <RecRow key={i} rec={rec} onActor={onActor} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
