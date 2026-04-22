import { useState, useEffect, useRef, useMemo, useCallback, startTransition, type ReactElement } from "react";
import { Breadcrumbs } from "../Breadcrumbs";
import { Loading } from "../Loading";
import { loadAtlas } from "../../lib/docs";
import { loadAddresses } from "../../lib/addresses";
import { loadChainState, type ChainValue } from "../../lib/chainstate";
import { getEdges, type EdgeResult } from "../../lib/graph";
import { setAddressMap } from "../../lib/addressMap";
import { loadGlossary, buildLookup, type GlossaryEntry } from "../../lib/glossary";
import { type AtlasNode, type AddressInfo } from "../../types";
import { CollapsibleNode, flattenTree } from "./CollapsibleNode";
import { useDepth6Expand } from "./useDepth6Expand";
import { RightPanel } from "./RightPanel";
import {
  extractLinkedIds, buildAncestors,
  ATLAS_GRID_STYLE, ATLAS_LEFT_PANE_STYLE, ATLAS_EMPTY_SET,
  type LoadedData,
} from "../../lib/atlasHelpers";

const EMPTY_EDGES: EdgeResult = { outbound: [], inbound: [] };

const ViewChildrenFill = ({ nodeId, docNo, onExpand }: { nodeId: string; docNo: string; onExpand: (id: string) => void }) =>
  <button type="button" onClick={() => onExpand(nodeId)} className="view-children-fill w-full text-center mono text-[10px] text-tan-3 bg-transparent cursor-pointer">view all descendants of {docNo}</button>;

export function AtlasView({ id, onNavigate, view, onViewChange }: {
  id: string;
  onNavigate: (id: string) => void;
  view: "annotations" | "history";
  onViewChange: (v: "annotations" | "history") => void;
}) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [userToggles, setUserToggles] = useState<Set<string>>(new Set());
  const [graphEdges, setGraphEdges] = useState<EdgeResult>(EMPTY_EDGES);

  useEffect(() => {
    Promise.all([loadAtlas(), loadAddresses(), loadChainState(), loadGlossary()]).then(([atlas, addresses, chainState, glossary]) => {
      setAddressMap(addresses);
      startTransition(() => {
        setData({ atlas, flatNodes: flattenTree(atlas.byParent), addresses, chainState, glossary });
      });
    });
  }, []);

  useEffect(() => {
    setUserToggles(ATLAS_EMPTY_SET);
    setGraphEdges(EMPTY_EDGES);
    if (id) getEdges(id).then(setGraphEdges);
  }, [id]);

  const autoExpanded = useMemo(() => {
    if (!data || !id) return new Set<string>();
    const { docs, byParent } = data.atlas;
    const target = docs[id];
    if (!target) return new Set<string>();
    const set = new Set<string>();
    set.add(id);
    if (target.parentId && docs[target.parentId]) set.add(target.parentId);
    for (const sib of byParent.get(target.parentId) ?? []) set.add(sib.id);
    return set;
  }, [data, id]);

  const ancestors = useMemo(() => {
    if (!data || !id) return [];
    return buildAncestors(data.atlas.docs, data.atlas.docNoToId, id);
  }, [data, id]);

  const { target, linkedNodes, targetAddresses, chainValues, glossaryTerms } = useMemo(() => {
    const empty = { target: null as AtlasNode | null, linkedNodes: [] as AtlasNode[], targetAddresses: {} as Record<string, AddressInfo>, chainValues: {} as Record<string, Record<string, ChainValue>>, glossaryTerms: [] as GlossaryEntry[][] };
    if (!data || !id) return empty;
    const { docs } = data.atlas;
    const target = docs[id] ?? null;
    if (!target) return empty;
    const linkedNodes = extractLinkedIds(target).map(lid => docs[lid]).filter((n): n is AtlasNode => !!n);
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
      if (!seen.has(entries) && entries.some(e => contentLower.includes(e.term.toLowerCase()))) {
        seen.add(entries);
        glossaryTerms.push(entries);
      }
    }
    glossaryTerms.sort((a, b) => a[0].term.localeCompare(b[0].term));
    return { target, linkedNodes, targetAddresses, chainValues: cv, glossaryTerms };
  }, [data, id]);

  const handleToggle = useCallback((nodeId: string) => {
    setUserToggles(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const { expandedParents, hasDeepChildren, expandParent } = useDepth6Expand(data?.flatNodes ?? [], id);

  // Scroll after expand: the target may be hidden (depth >= 6) until expandedParents is
  // populated, so we depend on expandedParents and guard with a ref to avoid re-scrolling
  // when "view children" clicks later change expandedParents.
  const scrolledRef = useRef<string | null>(null);
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

  const nodeList = useMemo(() => {
    if (!data) return null;
    const items: ReactElement[] = [];
    for (const entry of data.flatNodes) {
      if (entry.depth >= 6 && !expandedParents.has(entry.node.parentId ?? "")) continue;
      items.push(
        <CollapsibleNode key={entry.node.id} entry={entry}
          isSelected={entry.node.id === id}
          isExpanded={autoExpanded.has(entry.node.id) !== userToggles.has(entry.node.id)}
          onNavigate={onNavigate} onToggle={handleToggle} />
      );
      if (hasDeepChildren.has(entry.node.id) && !expandedParents.has(entry.node.id)) {
        items.push(<ViewChildrenFill key={`fill-${entry.node.id}`} nodeId={entry.node.id} docNo={entry.node.doc_no} onExpand={expandParent} />);
      }
    }
    return items;
  }, [data, id, autoExpanded, userToggles, onNavigate, handleToggle, expandedParents, hasDeepChildren, expandParent]);

  if (!data) {
    return <Loading />;
  }
  if (id && !data.atlas.docs[id]) {
    return <div className="flex items-center justify-center py-24 text-sm text-red">Node not found: {id}</div>;
  }

  const addressCount = Object.keys(targetAddresses).length;
  const annotationCount = linkedNodes.length + addressCount;

  return (
    <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
      {id && <Breadcrumbs ancestors={ancestors} onNavigate={onNavigate} />}
      <div className="flex-1 lg:grid lg:grid-cols-[3fr_2fr]" style={ATLAS_GRID_STYLE}>
        <div className="overflow-y-auto" style={ATLAS_LEFT_PANE_STYLE}>
          <div className="mx-auto px-3 py-2">
            {nodeList}
          </div>
        </div>
        {id && (
          <div className="flex flex-col hidden lg:flex" style={{ minHeight: 0 }}>
            <RightPanel
              id={id}
              node={target}
              linkedNodes={linkedNodes}
              targetAddresses={targetAddresses}
              chainValues={chainValues}
              annotationCount={annotationCount}
              graphEdges={graphEdges}
              glossaryTerms={glossaryTerms}
              onNavigate={onNavigate}
              tab={view}
              onTabChange={onViewChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
