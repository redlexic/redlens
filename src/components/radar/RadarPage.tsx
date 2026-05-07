import { Suspense, use, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { loadDocs } from "../../lib/docs";
import { loadGraph } from "../../lib/graph";
import { buildRewardsIndex } from "../../lib/rewardsIndex";
import { buildActiveDataRows } from "../../lib/activeDataIndex";
import { buildSidebarActors, buildActorProfile } from "../../lib/actorIndex";
import { buildPrimitiveStats } from "../../lib/primitiveStats";
import { ActorList } from "./ActorList";
import { ActorDashboard } from "./ActorDashboard";
import { PrimitiveDashboard } from "./PrimitiveDashboard";
import { Drawer, DrawerToggle } from "../Drawer";
import { Loading } from "../Loading";

interface Props {
  onNavigate: (id: string) => void;
  query: string;
  actorSlug?: string;
}

interface InnerProps extends Props {
  drawerOpen: boolean;
  onDrawerClose: () => void;
  onActor: (slug: string) => void;
}

function RadarLoaded({ onNavigate, query, actorSlug, drawerOpen, onDrawerClose, onActor }: InnerProps) {
  const docs = use(loadDocs());
  const graph = use(loadGraph());

  const sidebarGroups = useMemo(() => buildSidebarActors(graph, docs), [graph, docs]);
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sidebarGroups;
    return sidebarGroups
      .map((g) => ({ ...g, actors: g.actors.filter((a) => a.name.toLowerCase().includes(q)) }))
      .filter((g) => g.actors.length > 0);
  }, [sidebarGroups, query]);

  const rewardsIndex = useMemo(() => buildRewardsIndex(docs, graph), [docs, graph]);
  const allActiveDataRows = useMemo(() => buildActiveDataRows(docs, graph), [docs, graph]);
  const primitiveStats = useMemo(() => buildPrimitiveStats(graph, docs), [graph, docs]);
  const profile = useMemo(() => {
    if (!actorSlug) return null;
    return buildActorProfile(actorSlug, graph, docs, rewardsIndex, allActiveDataRows);
  }, [actorSlug, graph, docs, rewardsIndex, allActiveDataRows]);

  return (
    <>
      <Drawer open={drawerOpen} onClose={onDrawerClose} breakpoint={850}>
        <ActorList groups={filteredGroups} selectedSlug={actorSlug ?? null} onSelect={onActor} />
      </Drawer>
      {!actorSlug ? (
        <PrimitiveDashboard agents={primitiveStats} onActor={onActor} onNavigate={onNavigate} />
      ) : !profile ? (
        <Loading>actor not found</Loading>
      ) : (
        <ActorDashboard profile={profile} onNavigate={onNavigate} onActor={onActor} />
      )}
    </>
  );
}

export function RadarPage({ onNavigate, query, actorSlug }: Props) {
  const [, navigate] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const selectActor = (slug: string, fragment?: string) => {
    navigate(`/radar/${slug}${fragment ? `#${fragment}` : ""}`);
    setDrawerOpen(false);
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      <Suspense fallback={
        <div className="flex-1 flex flex-col overflow-hidden">
          <DrawerToggle label="Actors" onClick={() => setDrawerOpen(true)} breakpoint={850} />
          <Loading />
        </div>
      }>

        <DrawerToggle label="Actors" onClick={() => setDrawerOpen(true)} breakpoint={850} />
        <RadarLoaded
          onNavigate={onNavigate}
          query={query}
          actorSlug={actorSlug}
          drawerOpen={drawerOpen}
          onDrawerClose={() => setDrawerOpen(false)}
          onActor={selectActor}
        />
      </Suspense>
    </div>
  );
}
