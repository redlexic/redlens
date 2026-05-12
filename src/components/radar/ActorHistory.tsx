import { useEffect, useState } from "react";
import { Link } from "wouter";
import { loadHistory, type HistoryEntry } from "../../lib/history";
import type { ActorProfile } from "../../lib/actorIndex";
import type { AtlasNode } from "../../types";
import { ROUTES } from "../../lib/routes";
import { useRadar } from "./RadarContext";

type Category = "definition" | "instance" | "param" | "primitive" | "reward";

interface AffectedDoc {
  docId: string;
  docNo: string | null;
  category: Category;
  /** matched-bullet summary for this doc, when distinct from prTitle */
  summary?: string;
}

interface MergedEntry {
  date: string;
  commitHash: string;
  changeType: "added" | "modified" | "removed";
  pr?: number;
  prTitle?: string;
  prAuthor?: string;
  prUrl?: string;
  docs: AffectedDoc[];
}

const CATEGORY_LABEL: Record<Category, string> = {
  definition: "agent definition",
  instance: "agent instance",
  param: "instance parameter",
  primitive: "primitive agent owns",
  reward: "rewards primitive",
};

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

function buildDocCategoryMap(profile: ActorProfile): Map<string, Category> {
  const map = new Map<string, Category>();
  // Lowest priority first; later writes override.
  for (const inst of profile.instances) {
    if (inst.primitiveDocId) map.set(inst.primitiveDocId, "primitive");
  }
  if (profile.rewardsAgent?.dr?.primitiveId) map.set(profile.rewardsAgent.dr.primitiveId, "reward");
  if (profile.rewardsAgent?.ib?.primitiveId) map.set(profile.rewardsAgent.ib.primitiveId, "reward");
  // Param-source docs first so the instance-root override wins if a param
  // points at its own config root (rare but possible).
  for (const inst of profile.instances) {
    for (const p of inst.signalParams) {
      if (p.srcDocId) map.set(p.srcDocId, "param");
    }
  }
  for (const inst of profile.instances) {
    if (inst.docId) map.set(inst.docId, "instance");
  }
  if (profile.definingDoc) map.set(profile.definingDoc.id, "definition");
  return map;
}

function mergeByCommit(
  perDoc: ReadonlyArray<readonly [string, HistoryEntry[]]>,
  docCategory: Map<string, Category>,
  docs: Record<string, AtlasNode>,
): MergedEntry[] {
  const byCommit = new Map<string, MergedEntry>();
  for (const [docId, entries] of perDoc) {
    const category = docCategory.get(docId);
    if (!category) continue;
    for (const entry of entries) {
      // "moved" events are renumbering noise (atomization, doc-no reshuffles).
      if (entry.changeType === "moved") continue;
      const affected: AffectedDoc = {
        docId,
        docNo: docs[docId]?.doc_no ?? null,
        category,
        // The build script reuses summary=prTitle as a non-bulleted-PR fallback,
        // so only keep summary when it carries new information.
        summary: entry.summary && entry.summary !== entry.prTitle ? entry.summary : undefined,
      };
      const existing = byCommit.get(entry.commitHash);
      if (existing) {
        if (!existing.docs.some((d) => d.docId === docId)) existing.docs.push(affected);
      } else {
        byCommit.set(entry.commitHash, {
          date: entry.date,
          commitHash: entry.commitHash,
          changeType: entry.changeType as MergedEntry["changeType"],
          pr: entry.pr,
          prTitle: entry.prTitle,
          prAuthor: entry.prAuthor,
          prUrl: entry.prUrl,
          docs: [affected],
        });
      }
    }
  }
  return [...byCommit.values()].sort((a, b) => b.date.localeCompare(a.date));
}

interface Props {
  profile: ActorProfile;
}

export function ActorHistory({ profile }: Props) {
  const { docs } = useRadar();
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
        setEntries(mergeByCommit(results, docCategory, docs));
        setLoading(false);
      },
    );
    return () => { cancelled = true; };
  }, [profile, docs]);

  if (loading) {
    return <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>loading history…</p>;
  }
  if (!entries || entries.length === 0) {
    return <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>no history recorded</p>;
  }
  return (
    <div>
      {entries.map((e) => (
        <Entry key={e.commitHash} entry={e} />
      ))}
    </div>
  );
}

function docHref(docId: string): string {
  return `${ROUTES.ATLAS}?id=${docId}&view=history`;
}

function Entry({ entry }: { entry: MergedEntry }) {
  const color = CHANGE_COLOR[entry.changeType] ?? "var(--tan-3)";
  return (
    <div className="border-b py-2" style={{ borderColor: "var(--border)" }}>
      <div className="text-sm leading-snug mb-1" style={{ color: "var(--tan)" }}>
        {entry.prTitle ?? "(no PR)"}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap mono text-[10px] mb-1">
        <span style={{ color: "var(--tan-3)" }}>{entry.date}</span>
        <span style={{ color }}>{CHANGE_LABEL[entry.changeType]}</span>
        {entry.pr && (
          <a href={entry.prUrl} target="_blank" rel="noopener noreferrer"
             className="hover:underline focus-visible:underline" style={{ color: "var(--accent)" }}>
            #{entry.pr}
          </a>
        )}
        <a href={`https://github.com/sky-ecosystem/next-gen-atlas/commit/${entry.commitHash}`}
           target="_blank" rel="noopener noreferrer"
           className="hover:underline focus-visible:underline" style={{ color: "var(--tan-3)" }}>
          {entry.commitHash}
        </a>
        {entry.prAuthor && <span style={{ color: "var(--tan-3)" }}>{entry.prAuthor}</span>}
      </div>
      <ul className="space-y-1">
        {entry.docs.map((d) => (
          <li key={d.docId}>
            <div className="mono text-[10px] flex items-baseline gap-2 flex-wrap"
                 style={{ color: "var(--tan-3)" }}>
              {d.docNo && (
                <Link to={docHref(d.docId)}
                      className="hover:underline focus-visible:underline"
                      style={{ color: "var(--accent)" }}>
                  {d.docNo}
                </Link>
              )}
              <Link to={docHref(d.docId)} title={d.docId}
                    className="hover:underline focus-visible:underline"
                    style={{ color: "var(--accent)" }}>
                {d.docId.split("-").slice(0, 2).join("-")}
              </Link>
              <span className="px-1 rounded"
                    style={{ background: "var(--hover)", color: "var(--tan-2)" }}>
                {CATEGORY_LABEL[d.category]}
              </span>
            </div>
            {d.summary && (
              <div
                className="text-[11px] italic leading-[14px] pl-2 ml-1 mt-0.5"
                style={{ color: "var(--tan-2)", borderLeft: "2px solid var(--border)" }}
              >
                {d.summary}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
