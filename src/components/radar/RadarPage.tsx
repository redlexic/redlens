import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearchParams } from "wouter";
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
}

export function RadarPage({ onNavigate }: Props) {
  const [, navigate] = useLocation();
  const [searchParams] = useSearchParams();
  const actorSlug = searchParams.get("actor");
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
    navigate(`/radar?actor=${slug}`);
    setDrawerOpen(false);
  };

  const ready = docs !== null && graph !== null;

  return (
    <div className="flex-1 flex overflow-hidden">
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} breakpoint={850}>
        {ready ? (
          <ActorList groups={sidebarGroups} selectedSlug={actorSlug} onSelect={selectActor} />
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
