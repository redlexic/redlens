import {
  useState,
  useEffect,
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
import { CollapsibleNode } from "./CollapsibleNode";
import { flattenTree } from "../../lib/atlasHelpers";
import { useDepth6Expand } from "./useDepth6Expand";
import { RightPanel } from "./RightPanel";
import { JuniorPane } from "./JuniorPane";
import { ErrorBoundary, PanelError } from "../ErrorBoundary";
import { DrawerToggle } from "../Drawer";
import { useExpandingAttr } from "../../hooks/useExpandingAttr";
import {
  extractLinkedIds,
  buildAncestorsWithSelf,
  ATLAS_GRID_STYLE,
  ATLAS_LEFT_PANE_STYLE,
  ATLAS_EMPTY_SET,
  type LoadedData,
} from "../../lib/atlasHelpers";

const EMPTY_EDGES: EdgeResult = { outbound: [], inbound: [] };

const RIGHT_PANEL_KEY = "redlens:right-panel-width";
const RIGHT_PANEL_MIN = 260; // keeps annotations / glossary / history tabs visible
const RIGHT_PANEL_MAX = 800;
const RIGHT_PANEL_DEFAULT = 420;

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
  view: "annotations" | "glossary" | "history";
  onViewChange: (v: "annotations" | "glossary" | "history") => void;
  splitId: string | null;
  onSplitChange: (id: string | null) => void;
  onOpenTree?: () => void;
}) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [userToggles, setUserToggles] = useState<Set<string>>(new Set());
  const [graphEdges, setGraphEdges] = useState<EdgeResult>(EMPTY_EDGES);
  const [rightWidth, setRightWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(RIGHT_PANEL_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= RIGHT_PANEL_MIN && n <= RIGHT_PANEL_MAX) return n;
      }
    } catch {}
    return RIGHT_PANEL_DEFAULT;
  });

  const startResizeRight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = rightWidth;
      let latest = startWidth;
      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        // dragging LEFT (toward viewport-left) widens the right panel
        const delta = startX - ev.clientX;
        latest = Math.max(RIGHT_PANEL_MIN, Math.min(RIGHT_PANEL_MAX, startWidth + delta));
        setRightWidth(latest);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        try {
          localStorage.setItem(RIGHT_PANEL_KEY, String(latest));
        } catch {}
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [rightWidth],
  );
  // Grows-only: once expanded, stays expanded across navigations so the user's context
  // (previously visited nodes) doesn't collapse out from under them.
  const seenExpanded = useRef<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  // Only the target itself auto-expands on navigation. Parents and siblings stay as
  // they were — clicking a node opens just that node in place without shifting
  // surrounding rows. Anything previously visited stays expanded via seenExpanded.
  const expandedSet = useMemo(() => {
    if (!data || !id) return ATLAS_EMPTY_SET;
    if (!data.atlas.docs[id]) return new Set(seenExpanded.current);
    seenExpanded.current.add(id);
    return new Set(seenExpanded.current);
  }, [data, id]);

  const ancestors = useMemo(() => {
    if (!data || !id) return [];
    return buildAncestorsWithSelf(data.atlas.docs, data.atlas.docNoToId, id);
  }, [data, id]);

  // Glossary lookup is stable once data loads — separate memo so it isn't
  // rebuilt on every navigation (the outer memo re-runs on every id change).
  const glossaryLookup = useMemo(
    () => (data ? buildLookup(data.glossary) : {}),
    [data],
  );

  const { linkedNodes, targetAddresses, chainValues, glossaryTerms } = useMemo(() => {
    const empty = {
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
    const contentLower = target.content.toLowerCase();
    const seen = new Set<GlossaryEntry[]>();
    const glossaryTerms: GlossaryEntry[][] = [];
    for (const entries of Object.values(glossaryLookup)) {
      if (!seen.has(entries) && entries.some((e) => contentLower.includes(e.term.toLowerCase()))) {
        seen.add(entries);
        glossaryTerms.push(entries);
      }
    }
    glossaryTerms.sort((a, b) => a[0].term.localeCompare(b[0].term));
    return { linkedNodes, targetAddresses, chainValues: cv, glossaryTerms };
  }, [data, id, glossaryLookup]);

  const handleToggle = useCallback((nodeId: string) => {
    setUserToggles((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const { expandedParents, hiddenCount, expandParent } = useDepth6Expand(
    data?.flatNodes ?? [],
    id,
  );

  const triggerExpandingAnim = useExpandingAttr(scrollContainerRef);
  const handleExpandParent = useCallback((nodeId: string) => {
    expandParent(nodeId);
    triggerExpandingAnim();
  }, [expandParent, triggerExpandingAnim]);

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
      const gatedCount = expandedParents.has(entry.node.id) ? 0 : (hiddenCount.get(entry.node.id) ?? 0);
      const parentDocNo = entry.node.parentId
        ? data.atlas.docs[entry.node.parentId]?.doc_no
        : undefined;
      items.push(
        <CollapsibleNode
          key={entry.node.id}
          entry={entry}
          isSelected={entry.node.id === id}
          isExpanded={expandedSet.has(entry.node.id) !== userToggles.has(entry.node.id)}
          hiddenCount={gatedCount}
          parentDocNo={parentDocNo}
          onExpandChildren={handleExpandParent}
          onNavigate={onNavigate}
          onToggle={handleToggle}
          onShiftNavigate={onSplitChange}
        />,
      );
    }
    return items;
  }, [
    data,
    id,
    expandedSet,
    userToggles,
    onNavigate,
    handleToggle,
    expandedParents,
    hiddenCount,
    handleExpandParent,
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
        {id && <Breadcrumbs ancestors={ancestors} />}
      </div>
      <div
        className="flex-1 flex"
        style={ATLAS_GRID_STYLE}
      >
        <div
          className="relative flex flex-col overflow-hidden flex-1 min-w-0"
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
          <div ref={scrollContainerRef} className="atlas-scroll overflow-y-auto flex-1" style={{ minHeight: 0 }}>
            <div className="mx-auto py-2">
              <ErrorBoundary key={id} fallback={<PanelError />}>
                {docList}
              </ErrorBoundary>
            </div>
          </div>
          {splitId && data && (
            <ErrorBoundary key={splitId} fallback={<PanelError />}>
              <JuniorPane
                splitId={splitId}
                data={data}
                onShiftNavigate={onSplitChange}
                onClose={() => onSplitChange(null)}
              />
            </ErrorBoundary>
          )}
        </div>
        {id && (
          <div
            className="relative hidden min-[750px]:flex flex-col"
            style={{ width: rightWidth, flexShrink: 0, minHeight: 0 }}
          >
            <div
              onMouseDown={startResizeRight}
              title="Drag to resize"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: -3,
                width: 6,
                cursor: "col-resize",
                zIndex: 10,
              }}
            />
            <ErrorBoundary key={id} fallback={(_, reset) => <PanelError reset={reset} />}>
              <RightPanel
                id={id}
                linkedNodes={linkedNodes}
                targetAddresses={targetAddresses}
                chainValues={chainValues}
                annotationCount={annotationCount}
                graphEdges={graphEdges}
                glossaryTerms={glossaryTerms}
                onNavigate={onNavigate}
                onNavigateByDocNo={(docNo) => {
                  const uuid = data?.atlas.docNoToId.get(docNo);
                  if (uuid) onNavigate(uuid);
                }}
                tab={view}
                onTabChange={onViewChange}
              />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}
