import { useEffect, useState } from "react";
import { loadHistory, type HistoryEntry } from "../../lib/history";
import type { ActorProfile } from "../../lib/actorIndex";

type Category = "definition" | "instance" | "primitive" | "reward";

interface MergedEntry extends HistoryEntry {
  affectedDocIds: string[];
  categories: Category[];
  /** Distinct matched-bullet titles across all affected docs in this commit.
   *  Empty when no doc had a bullet match (PR had no bullets, or none scored ≥ 0.35). */
  bullets: string[];
}

const CATEGORY_LABEL: Record<Category, string> = {
  definition: "definition",
  instance: "instance",
  primitive: "primitive",
  reward: "reward",
};

const CATEGORY_ORDER: Category[] = ["definition", "instance", "primitive", "reward"];

function buildDocCategoryMap(profile: ActorProfile): Map<string, Category> {
  const map = new Map<string, Category>();
  // Lowest priority first; later writes override.
  for (const inst of profile.instances) {
    if (inst.primitiveDocId) map.set(inst.primitiveDocId, "primitive");
  }
  if (profile.rewardsAgent?.dr?.id) map.set(profile.rewardsAgent.dr.id, "reward");
  if (profile.rewardsAgent?.ib?.id) map.set(profile.rewardsAgent.ib.id, "reward");
  for (const inst of profile.instances) {
    if (inst.docId) map.set(inst.docId, "instance");
  }
  if (profile.definingDoc) map.set(profile.definingDoc.id, "definition");
  return map;
}

function mergeByCommit(
  perDoc: Array<[string, HistoryEntry[]]>,
  docCategory: Map<string, Category>,
): MergedEntry[] {
  const byCommit = new Map<string, MergedEntry>();
  const bulletsByCommit = new Map<string, string[]>();

  for (const [docId, entries] of perDoc) {
    for (const entry of entries) {
      const existing = byCommit.get(entry.commitHash);
      if (existing) {
        if (!existing.affectedDocIds.includes(docId)) existing.affectedDocIds.push(docId);
      } else {
        byCommit.set(entry.commitHash, {
          ...entry,
          affectedDocIds: [docId],
          categories: [],
          bullets: [],
        });
      }
      // Treat summary as a matched bullet only when it differs from prTitle
      // (the build script reuses summary=prTitle as the non-bulleted-PR fallback).
      if (entry.summary && entry.summary !== entry.prTitle) {
        const list = bulletsByCommit.get(entry.commitHash) ?? [];
        if (!list.includes(entry.summary)) list.push(entry.summary);
        bulletsByCommit.set(entry.commitHash, list);
      }
    }
  }

  for (const entry of byCommit.values()) {
    const seen = new Set<Category>();
    for (const docId of entry.affectedDocIds) {
      const cat = docCategory.get(docId);
      if (cat) seen.add(cat);
    }
    entry.categories = CATEGORY_ORDER.filter((c) => seen.has(c));
    entry.bullets = bulletsByCommit.get(entry.commitHash) ?? [];
  }
  return [...byCommit.values()].sort((a, b) => b.date.localeCompare(a.date));
}

const CHANGE_COLOR: Record<string, string> = {
  added: "var(--depth-6)",
  modified: "var(--tan-3)",
  removed: "var(--red)",
};

const CHANGE_LABEL: Record<string, string> = {
  added: "added",
  modified: "edited",
  removed: "removed",
};

interface Props {
  profile: ActorProfile;
}

export function ActorHistory({ profile }: Props) {
  const [entries, setEntries] = useState<MergedEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEntries(null);
    const docCategory = buildDocCategoryMap(profile);
    const ids = [...docCategory.keys()];
    Promise.all(ids.map((id) => loadHistory(id).then((h) => [id, h ?? []] as const))).then(
      (results) => {
        if (cancelled) return;
        setEntries(mergeByCommit(results, docCategory));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [profile]);

  if (loading) {
    return (
      <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        loading history…
      </p>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        no history recorded
      </p>
    );
  }

  return (
    <div>
      {entries.map((entry) => (
        <Entry key={entry.commitHash} entry={entry} />
      ))}
    </div>
  );
}

function Entry({ entry }: { entry: MergedEntry }) {
  const color = CHANGE_COLOR[entry.changeType] ?? "var(--tan-3)";
  const hasPr = !!entry.pr;

  return (
    <div className="border-b py-2" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-baseline gap-2 flex-wrap mono text-[10px] mb-0.5">
        <span style={{ color: "var(--tan-3)" }}>{entry.date}</span>
        <span style={{ color }}>{CHANGE_LABEL[entry.changeType]}</span>
        {entry.categories.map((cat) => (
          <span
            key={cat}
            className="px-1 rounded"
            style={{ background: "var(--hover)", color: "var(--tan-2)" }}
          >
            {CATEGORY_LABEL[cat]}
          </span>
        ))}
        {entry.affectedDocIds.length > 1 && (
          <span style={{ color: "var(--tan-3)", opacity: 0.7 }}>
            ×{entry.affectedDocIds.length}
          </span>
        )}
        {hasPr && (
          <a
            href={entry.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline focus-visible:underline"
            style={{ color: "var(--accent)" }}
          >
            #{entry.pr}
          </a>
        )}
        <a
          href={`https://github.com/sky-ecosystem/next-gen-atlas/commit/${entry.commitHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline focus-visible:underline"
          style={{ color: "var(--tan-3)" }}
        >
          {entry.commitHash}
        </a>
        {hasPr && entry.prAuthor && (
          <span style={{ color: "var(--tan-3)" }}>{entry.prAuthor}</span>
        )}
      </div>
      {entry.bullets.length > 0 ? (
        <ul className="text-sm leading-snug space-y-0.5" style={{ color: "var(--tan)" }}>
          {entry.bullets.map((b, i) => (
            <li key={i} className="flex gap-1.5">
              <span style={{ color: "var(--tan-3)" }}>·</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : entry.prTitle ? (
        <div className="text-sm leading-snug" style={{ color: "var(--tan)" }}>
          {entry.prTitle}
        </div>
      ) : null}
    </div>
  );
}
