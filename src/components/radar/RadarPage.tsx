import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { loadDocs } from "../../lib/docs";
import { loadGraph } from "../../lib/graph";
import type { GraphData } from "../../lib/graph";
import type { AtlasNode } from "../../types";
import { buildRewardsIndex } from "../../lib/rewardsIndex";
import { buildActiveDataRows } from "../../lib/activeDataIndex";
import { buildSidebarActors, buildActorProfile, type SidebarGroup } from "../../lib/actorIndex";
import { ActorList } from "./ActorList";
import { ActorDashboard } from "./ActorDashboard";
import { Drawer, DrawerToggle } from "../Drawer";

interface Props {
  onNavigate: (id: string) => void;
  query: string;
  actorSlug?: string;
}

export function RadarPage({ onNavigate, query, actorSlug }: Props) {
  const [, navigate] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [docs, setDocs] = useState<Record<string, AtlasNode> | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);

  useEffect(() => {
    Promise.all([loadDocs(), loadGraph()]).then(([d, g]) => {
      setDocs(d);
      setGraph(g);
    });
  }, []);

  const sidebarGroups = useMemo((): SidebarGroup[] => {
    if (!graph || !docs) return [];
    return buildSidebarActors(graph, docs);
  }, [graph, docs]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sidebarGroups;
    return sidebarGroups
      .map((g) => ({ ...g, actors: g.actors.filter((a) => a.name.toLowerCase().includes(q)) }))
      .filter((g) => g.actors.length > 0);
  }, [sidebarGroups, query]);

  const rewardsIndex = useMemo(() => {
    if (!docs || !graph) return null;
    return buildRewardsIndex(docs, graph);
  }, [docs, graph]);

  const allActiveDataRows = useMemo(() => {
    if (!docs || !graph) return null;
    return buildActiveDataRows(docs, graph);
  }, [docs, graph]);

  const profile = useMemo(() => {
    if (!actorSlug || !graph || !docs || !rewardsIndex || !allActiveDataRows) return null;
    return buildActorProfile(actorSlug, graph, docs, rewardsIndex, allActiveDataRows);
  }, [actorSlug, graph, docs, rewardsIndex, allActiveDataRows]);

  const selectActor = (slug: string) => {
    navigate(`/radar/${slug}`);
    setDrawerOpen(false);
  };

  const ready = docs !== null && graph !== null;

  return (
    <div className="flex-1 flex overflow-hidden">
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} breakpoint={850}>
        {ready ? (
          <ActorList groups={filteredGroups} selectedSlug={actorSlug} onSelect={selectActor} />
        ) : (
          <div className="p-4 mono text-xs" style={{ color: "var(--tan-3)" }}>
            Loading…
          </div>
        )}
      </Drawer>

      <div className="flex-1 flex flex-col overflow-hidden">
        <DrawerToggle label="Actors" onClick={() => setDrawerOpen(true)} breakpoint={850} />

        {!ready ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="mono text-sm" style={{ color: "var(--tan-3)" }}>
              Loading graph…
            </span>
          </div>
        ) : !actorSlug ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="mono text-sm" style={{ color: "var(--tan-3)" }}>
              Select an Agent or Facilitator or GovOps
            </span>
          </div>
        ) : !profile ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="mono text-sm" style={{ color: "var(--tan-3)" }}>
              Actor not found
            </span>
          </div>
        ) : (
          <ActorDashboard profile={profile} onNavigate={onNavigate} onActor={selectActor} />
        )}
      </div>
    </div>
  );
}
