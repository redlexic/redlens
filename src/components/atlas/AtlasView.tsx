import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  startTransition,
  type ReactElement,
} from "react";
import { Breadcrumbs } from "../Breadcrumbs";
import { Loading } from "../Loading";
import { loadAtlas } from "../../lib/docs";
import { loadAddresses } from "../../lib/addresses";
import { loadChainState, type ChainValue } from "../../lib/chainstate";
import { getEdges, type EdgeResult } from "../../lib/graph";
import { setAddressMap } from "../../lib/addressMap";
import { loadGlossary, buildLookup, type GlossaryEntry } from "../../lib/glossary";
import { type AtlasNode, type AddressInfo } from "../../types";
import { CollapsibleNode, ViewChildrenFill } from "./CollapsibleNode";
import { flattenTree } from "../../lib/atlasHelpers";
import { useDepth6Expand } from "./useDepth6Expand";
import { RightPanel } from "./RightPanel";
import { JuniorPane } from "./JuniorPane";
import { DrawerToggle } from "../Drawer";
import {
  extractLinkedIds,
  buildAncestors,
  ATLAS_GRID_STYLE,
  ATLAS_LEFT_PANE_STYLE,
  ATLAS_EMPTY_SET,
  type LoadedData,
} from "../../lib/atlasHelpers";

const EMPTY_EDGES: EdgeResult = { outbound: [], inbound: [] };

export function AtlasView({
  id,
  onNavigate,
  view,
  onViewChange,
  splitId,
  onSplitChange,
  onOpenTree,
}: {
  id: string;
  onNavigate: (id: string) => void;
  view: "annotations" | "history";
  onViewChange: (v: "annotations" | "history") => void;
  splitId: string | null;
  onSplitChange: (id: string | null) => void;
  onOpenTree?: () => void;
}) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [userToggles, setUserToggles] = useState<Set<string>>(new Set());
  const [graphEdges, setGraphEdges] = useState<EdgeResult>(EMPTY_EDGES);
  // Grows-only: once a node is auto-expanded, it stays expanded across navigations to prevent layout jumps.
  const seenExpanded = useRef<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Captures the target element's position before navigation so useLayoutEffect can restore it.
  const scrollAnchor = useRef<{ id: string; top: number } | null>(null);

  useEffect(() => {
    Promise.all([loadAtlas(), loadAddresses(), loadChainState(), loadGlossary()]).then(
      ([atlas, addresses, chainState, glossary]) => {
        setAddressMap(addresses);
        startTransition(() => {
          setData({
            atlas,
            flatNodes: flattenTree(atlas.byParent),
            addresses,
            chainState,
            glossary,
          });
        });
      },
    );
  }, []);

  useEffect(() => {
    // Only remove the target itself from manual toggles so navigating to a previously
    // collapsed node always opens it. Don't reset all toggles — user's other collapses persist.
    setUserToggles((prev) => {
      if (!id || !prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setGraphEdges(EMPTY_EDGES);
    if (!id) return;
    let cancelled = false;
    getEdges(id).then((r) => {
      if (!cancelled) setGraphEdges(r);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const autoExpanded = useMemo(() => {
    if (!data || !id) return ATLAS_EMPTY_SET;
    const { docs, byParent } = data.atlas;
    const target = docs[id];
    if (!target) return ATLAS_EMPTY_SET;
    const set = new Set<string>();
    set.add(id);
    if (target.parentId && docs[target.parentId]) set.add(target.parentId);
    for (const sib of byParent.get(target.parentId) ?? []) set.add(sib.id);
    for (const nodeId of set) seenExpanded.current.add(nodeId);
    return set;
  }, [data, id]);

  const effectiveExpanded = useMemo(() => {
    const combined = new Set(seenExpanded.current);
    for (const nodeId of autoExpanded) combined.add(nodeId);
    return combined;
  }, [autoExpanded]);

  const ancestors = useMemo(() => {
    if (!data || !id) return [];
    return buildAncestors(data.atlas.docs, data.atlas.docNoToId, id);
  }, [data, id]);

  const { target, linkedNodes, targetAddresses, chainValues, glossaryTerms } = useMemo(() => {
    const empty = {
      target: null as AtlasNode | null,
      linkedNodes: [] as AtlasNode[],
      targetAddresses: {} as Record<string, AddressInfo>,
      chainValues: {} as Record<string, Record<string, ChainValue>>,
      glossaryTerms: [] as GlossaryEntry[][],
    };
    if (!data || !id) return empty;
    const { docs } = data.atlas;
    const target = docs[id] ?? null;
    if (!target) return empty;
    const linkedNodes = extractLinkedIds(target)
      .map((lid) => docs[lid])
      .filter((n): n is AtlasNode => !!n);
    const targetAddresses: Record<string, AddressInfo> = {};
    const cv: Record<string, Record<string, ChainValue>> = {};
    for (const ref of target.addressRefs ?? []) {
      const info = data.addresses[ref];
      if (info) targetAddresses[ref] = info;
      const val = data.chainState.values[ref];
      if (val) cv[ref] = val;
    }
    const lookup = buildLookup(data.glossary);
    const contentLower = target.content.toLowerCase();
    const seen = new Set<GlossaryEntry[]>();
    const glossaryTerms: GlossaryEntry[][] = [];
    for (const entries of Object.values(lookup)) {
      if (!seen.has(entries) && entries.some((e) => contentLower.includes(e.term.toLowerCase()))) {
        seen.add(entries);
        glossaryTerms.push(entries);
      }
    }
    glossaryTerms.sort((a, b) => a[0].term.localeCompare(b[0].term));
    return { target, linkedNodes, targetAddresses, chainValues: cv, glossaryTerms };
  }, [data, id]);

  const handleToggle = useCallback((nodeId: string) => {
    setUserToggles((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleNavigate = useCallback(
    (nodeId: string) => {
      const container = scrollContainerRef.current;
      const el = document.getElementById(nodeId);
      if (container && el) {
        scrollAnchor.current = {
          id: nodeId,
          top: el.getBoundingClientRect().top - container.getBoundingClientRect().top,
        };
      } else {
        scrollAnchor.current = null;
      }
      onNavigate(nodeId);
    },
    [onNavigate],
  );

  const { expandedParents, hasDeepChildren, expandParent } = useDepth6Expand(
    data?.flatNodes ?? [],
    id,
  );

  // Restore the pre-render scroll position before the browser paints, preventing the
  // visual jump that occurs when siblings expand and push the selected node downward.
  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    if (!anchor || anchor.id !== id) return;
    scrollAnchor.current = null;
    const container = scrollContainerRef.current;
    const el = document.getElementById(id);
    if (!container || !el) return;
    const delta =
      el.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 1) container.scrollTop += delta;
  }, [id]);

  // scrolledRef guards against re-scrolling when only expandedParents changes (depth-6 expand).
  // Reset on every id change so revisiting a node re-checks and scrolls if needed.
  const scrolledRef = useRef<string | null>(null);
  useEffect(() => {
    scrolledRef.current = null;
  }, [id]);

  useEffect(() => {
    if (!id || !data) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el || scrolledRef.current === id) return;
      const { top, bottom } = el.getBoundingClientRect();
      if (bottom <= 64 || top >= window.innerHeight)
        el.scrollIntoView({ behavior: "instant", block: "start" });
      scrolledRef.current = id;
    });
  }, [id, data, expandedParents]);

  const docList = useMemo(() => {
    if (!data) return null;
    const items: ReactElement[] = [];
    for (const entry of data.flatNodes) {
      if (entry.depth >= 6 && !expandedParents.has(entry.node.parentId ?? "")) continue;
      items.push(
        <CollapsibleNode
          key={entry.node.id}
          entry={entry}
          isSelected={entry.node.id === id}
          isExpanded={effectiveExpanded.has(entry.node.id) !== userToggles.has(entry.node.id)}
          onNavigate={handleNavigate}
          onToggle={handleToggle}
          onShiftNavigate={onSplitChange}
        />,
      );
      if (hasDeepChildren.has(entry.node.id) && !expandedParents.has(entry.node.id)) {
        items.push(
          <ViewChildrenFill
            key={`fill-${entry.node.id}`}
            nodeId={entry.node.id}
            docNo={entry.node.doc_no}
            onExpand={expandParent}
          />,
        );
      }
    }
    return items;
  }, [
    data,
    id,
    effectiveExpanded,
    userToggles,
    handleNavigate,
    handleToggle,
    expandedParents,
    hasDeepChildren,
    expandParent,
    onSplitChange,
  ]);

  if (!data) {
    return <Loading />;
  }
  if (id && !data.atlas.docs[id]) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-red">
        Node not found: {id}
      </div>
    );
  }

  const addressCount = Object.keys(targetAddresses).length;
  const annotationCount = linkedNodes.length + addressCount;

  return (
    <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
      <div className="flex items-center" style={{
          borderBottom: "1px solid var(--border)",
      }}>
        <DrawerToggle label="Atlas" onClick={onOpenTree} breakpoint={1050} />
        {id && <Breadcrumbs ancestors={ancestors} onNavigate={handleNavigate} />}
      </div>
      <div
        className="flex-1 min-[750px]:grid min-[750px]:grid-cols-[3fr_2fr]"
        style={ATLAS_GRID_STYLE}
      >
        <div
          className="relative flex flex-col overflow-hidden"
          style={{ ...ATLAS_LEFT_PANE_STYLE, minHeight: 0 }}
        >
          {id && !splitId && (
            <button
              type="button"
              title="Open comparison pane (or shift-click any node)"
              onClick={() => onSplitChange(id)}
              aria-label="Open comparison pane"
              className="absolute top-2 right-2 z-10 mono text-[10px] px-1.5 py-0.5 rounded text-tan-3 hover:text-tan"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <svg
                width="12"
                height="10"
                viewBox="0 0 12 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                aria-hidden="true"
              >
                <rect x="0.5" y="0.5" width="11" height="3.5" rx="0.5" />
                <rect x="0.5" y="6" width="11" height="3.5" rx="0.5" />
              </svg>
            </button>
          )}
          <div ref={scrollContainerRef} className="overflow-y-auto flex-1" style={{ minHeight: 0 }}>
            <div className="mx-auto px-3 py-2">{docList}</div>
          </div>
          {splitId && data && (
            <JuniorPane
              splitId={splitId}
              data={data}
              onShiftNavigate={onSplitChange}
              onClose={() => onSplitChange(null)}
            />
          )}
        </div>
        {id && (
          <div className="flex flex-col hidden min-[750px]:flex" style={{ minHeight: 0 }}>
            <RightPanel
              id={id}
              node={target}
              linkedNodes={linkedNodes}
              targetAddresses={targetAddresses}
              chainValues={chainValues}
              annotationCount={annotationCount}
              graphEdges={graphEdges}
              glossaryTerms={glossaryTerms}
              onNavigate={handleNavigate}
              tab={view}
              onTabChange={onViewChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
