import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { type FlatEntry } from "../../lib/atlasHelpers";

export function useDepth6Expand(flatNodes: FlatEntry[], id: string) {
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  // Parent IDs whose children just became visible — used by the row renderer
  // to animate the *new* rows only (not initial mount, not navigation reshuffle).
  // Auto-clears 350ms after each expansion (animation runs ~200ms; small grace).
  const [recentlyExpanded, setRecentlyExpanded] = useState<Set<string>>(new Set());
  const pendingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => {
    for (const t of pendingTimers.current) clearTimeout(t);
    pendingTimers.current = [];
  }, []);

  const markRecent = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setRecentlyExpanded((prev) => {
      const next = new Set(prev);
      for (const entryId of ids) next.add(entryId);
      return next;
    });
    const t = setTimeout(() => {
      pendingTimers.current = pendingTimers.current.filter((x) => x !== t);
      setRecentlyExpanded((prev) => {
        const next = new Set(prev);
        for (const entryId of ids) next.delete(entryId);
        return next.size === prev.size ? prev : next;
      });
    }, 350);
    pendingTimers.current.push(t);
  }, []);

  // hiddenCount[parentId] = how many immediate children of `parentId` are at
  // depth >= 6 (i.e., would be revealed if the user expands `parentId`).
  // Single O(N) pass; lookup is O(1).
  const { hiddenCount, entryById } = useMemo(() => {
    const hiddenCount = new Map<string, number>();
    const entryById = new Map<string, FlatEntry>();
    for (const entry of flatNodes) {
      entryById.set(entry.node.id, entry);
      if (entry.depth >= 6 && entry.node.parentId) {
        hiddenCount.set(entry.node.parentId, (hiddenCount.get(entry.node.parentId) ?? 0) + 1);
      }
    }
    return { hiddenCount, entryById };
  }, [flatNodes]);

  // On navigation, two auto-expansions:
  //   1. If the target is depth-4+, walk up and expand every ancestor on the path
  //      so the path to the target becomes visible (sibling branches keep their fills).
  //   2. If the target itself has gated descendants, expand them too — so selecting
  //      a row that shows the bottom-right ▼ affordance auto-reveals its subtree
  //      (same effect as clicking the affordance manually).
  useEffect(() => {
    if (!id) return;
    const target = entryById.get(id);
    if (!target) return;
    const added: string[] = [];
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (target.depth >= 6) {
        let cur = target;
        while (cur.depth >= 6) {
          const parentId = cur.node.parentId;
          if (!parentId) break;
          if (!prev.has(parentId)) added.push(parentId);
          next.add(parentId);
          const parent = entryById.get(parentId);
          if (!parent) break;
          cur = parent;
        }
      }
      if ((hiddenCount.get(target.node.id) ?? 0) > 0 && !prev.has(target.node.id)) {
        added.push(target.node.id);
        next.add(target.node.id);
      }
      return next.size === prev.size ? prev : next;
    });
    markRecent(added);
  }, [id, entryById, hiddenCount, markRecent]);

  const expandParent = useCallback(
    (nodeId: string) => {
      setExpandedParents((prev) => {
        if (prev.has(nodeId)) return prev;
        return new Set([...prev, nodeId]);
      });
      markRecent([nodeId]);
    },
    [markRecent],
  );

  return { expandedParents, recentlyExpanded, hiddenCount, expandParent };
}
