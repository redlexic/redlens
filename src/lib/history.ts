/** Word-level segment within an intraline diff */
export type WordSegment = ["=" | "+" | "-", string];

/** Single diff line:
 *  ["="|"+"|"-", text]  — unchanged / added / removed line
 *  ["~", segments]       — modified line with intraline word diff
 *  ["…"]                 — gap between context hunks
 */
export type DiffLine = ["=" | "+" | "-", string] | ["~", WordSegment[]] | ["…"];

export interface HistoryEntry {
  date: string;
  commitHash: string;
  changeType: "added" | "modified" | "removed";
  pr?: number;
  prTitle?: string;
  prAuthor?: string;
  prUrl?: string;
  reviewCount?: number;
  approvalCount?: number;
  commentCount?: number;
  /** Matched PR body bullet title, if any */
  summary?: string;
  /** Matched PR body bullet description, if any */
  description?: string;
  /** Per-node line diff */
  diff?: DiffLine[];
}

// Module-level cache: nodeId → promise
const cache = new Map<string, Promise<HistoryEntry[] | null>>();

export function loadHistory(nodeId: string): Promise<HistoryEntry[] | null> {
  let p = cache.get(nodeId);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}history/${nodeId}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    cache.set(nodeId, p);
  }
  return p;
}
