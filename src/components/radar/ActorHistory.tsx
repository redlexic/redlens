import { useEffect, useState } from "react";
import { Link } from "wouter";
import { loadHistory, type HistoryEntry } from "../../lib/history";
import type { ActorProfile } from "../../lib/actorIndex";
import type { AtlasNode } from "../../types";
import { ROUTES } from "../../lib/routes";
import { useRadar } from "./RadarContext";

type Category = "definition" | "instance" | "param" | "primitive" | "reward";
type ChangeKind = "lint" | "typo" | "semantic";

interface AffectedDoc {
  docId: string;
  docNo: string | null;
  category: Category;
  /** matched-bullet summary for this doc, when distinct from prTitle */
  summary?: string;
  /** Edit significance for modified entries — lets the UI mute trivial rows */
  changeKind?: ChangeKind;
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

const SUMMARY_TOOLTIP =
  "Best guess matching of PR bullets to modified docs using deterministic " +
  "doc_no/UUID references and ancestor-aware token-overlap fuzzy matching. " +
  "Might mismatch.";

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
      // The build script writes summary=bullet.title and description=bullet
      // body (or pr.title/pr.body for non-bulleted fallback). Display rules:
      //   - matched bullets: show summary (concise per-edit title — e.g.
      //     "Update Grove Artifact"). Skip description; it's typically dense
      //     PR-instruction prose that doesn't read as a summary.
      //   - SAEP/single-bullet fallback (summary collapses to prTitle): show
      //     description if it's actually descriptive text — not a bare URL,
      //     not just the PR title.
      const summaryUseful =
        entry.summary && entry.summary !== entry.prTitle ? entry.summary : null;
      const descIsUrlOnly =
        entry.description && /^\s*https?:\/\/\S+\s*$/.test(entry.description);
      const descriptionUseful =
        !summaryUseful &&
        entry.description &&
        entry.description !== entry.prTitle &&
        !descIsUrlOnly
          ? entry.description
          : null;
      const affected: AffectedDoc = {
        docId,
        docNo: docs[docId]?.doc_no ?? null,
        category,
        summary: summaryUseful ?? descriptionUseful ?? undefined,
        changeKind: entry.changeKind,
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

/** Group docs by summary so a bullet attributed to N docs renders once
 *  with N child rows instead of being repeated. Insertion order is
 *  preserved; summary-less docs share a single trailing group. */
function groupBySummary(docs: AffectedDoc[]): Array<{ summary?: string; docs: AffectedDoc[] }> {
  const groups = new Map<string, { summary?: string; docs: AffectedDoc[] }>();
  for (const d of docs) {
    const key = d.summary ?? "\0";
    const existing = groups.get(key);
    if (existing) existing.docs.push(d);
    else groups.set(key, { summary: d.summary, docs: [d] });
  }
  return [...groups.values()];
}

function Entry({ entry }: { entry: MergedEntry }) {
  const color = CHANGE_COLOR[entry.changeType] ?? "var(--tan-3)";
  const groups = groupBySummary(entry.docs);
  return (
    <div className="border-b py-2" style={{ borderColor: "var(--border)" }}>
      <div className="text-sm leading-snug mb-1" style={{ color: "var(--tan)" }}>
        {entry.prTitle ?? "(no PR)"}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap mono text-[10px] mb-2">
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
      <div className="space-y-2">
        {groups.map((g, i) => (
          <DocGroup key={g.summary ?? `__${i}`} summary={g.summary} docs={g.docs} />
        ))}
      </div>
    </div>
  );
}

function DocGroup({ summary, docs }: { summary?: string; docs: AffectedDoc[] }) {
  return (
    <div>
      {summary && (
        <div
          className="text-[11px] italic leading-[14px] mb-1 cursor-help"
          style={{ color: "var(--tan-2)" }}
          title={SUMMARY_TOOLTIP}
        >
          {summary}
        </div>
      )}
      <ul
        className={summary ? "space-y-0.5 pl-2 ml-1" : "space-y-0.5"}
        style={summary ? { borderLeft: "2px solid var(--border)" } : undefined}
      >
        {docs.map((d) => (
          <li key={d.docId}
              className="mono text-[10px] flex items-baseline gap-2 flex-wrap"
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
            {d.changeKind && d.changeKind !== "semantic" && (
              <span className="px-1 rounded"
                    style={{ background: "transparent", color: "var(--tan-3)" }}
                    title={d.changeKind === "lint"
                      ? "Whitespace / formatting change only"
                      : "Small letter-level edit (likely typo / spelling)"}>
                {d.changeKind}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
