import { useState, useEffect, useCallback, startTransition, lazy, Suspense } from "react";
import { useLocation, useSearchParams, Switch, Route } from "wouter";
import { useSearchInput } from "./hooks/useSearchInput";
import { useNavigation } from "./hooks/useNavigation";
import { ROUTES, NAV_PAGE_ROUTES, type NavPage } from "./lib/routes";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { AtlasView } from "./components/atlas/AtlasView";
import { TreeSidebar } from "./components/tree/TreeSidebar";
import { Drawer, DrawerToggle } from "./components/Drawer";
import { prefetchNodeContent } from "./components/NodeContent";
import { Loading } from "./components/Loading";
import { SearchHintsPage } from "./components/SearchHints";
import { DevPanel } from "./DevPanel";
import { Footer } from "./components/Footer";

const ConstellationsPage = lazy(() => import("./components/ConstellationsPage").then(m => ({ default: m.ConstellationsPage })));
const OrgFacilitatorsReport = lazy(() => import("./components/reports/OrgFacilitatorsReport").then(m => ({ default: m.OFReport })));
const ActiveDataReport = lazy(() => import("./components/reports/ActiveDataReport").then(m => ({ default: m.ActiveDataReport })));
const RewardsReport = lazy(() => import("./components/reports/RewardsReport").then(m => ({ default: m.RewardsReport })));
const ReportsIndex = lazy(() => import("./components/ReportsIndex").then(m => ({ default: m.ReportsIndex })));
const ProvenancePage = lazy(() => import("./components/ProvenancePage").then(m => ({ default: m.ProvenancePage })));
const RadarPage = lazy(() => import("./components/radar/RadarPage").then(m => ({ default: m.RadarPage })));

prefetchNodeContent();

export default function App() {
  const [location, navigate] = useLocation();
  const [searchParams] = useSearchParams();
  const [splitId, setSplitId] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);

  const nodeId = location === ROUTES.ATLAS ? searchParams.get("id") : null;
  const atlasView = searchParams.get("view") === "history" ? "history" as const : "annotations" as const;
  const activeNavPage: NavPage | null = location.startsWith(ROUTES.CONSTELLATIONS) ? "constellations"
    : location.startsWith(ROUTES.REPORTS) ? "reports"
    : location.startsWith(ROUTES.RADAR) ? "radar"
    : location.startsWith(ROUTES.ATLAS) ? "atlas"
    : null;

  const { query, setQuery, inputRef, handleChange, state, ready, clearSearch, handleHintClick } = useSearchInput(location, navigate);
  const { navigateToNode, navigateToEntity, navigateToReport, handleViewChange } = useNavigation({ navigate, clearSearch, nodeId });

  const showTree = location === ROUTES.HOME || location === ROUTES.ATLAS || location === ROUTES.SEARCH_HINTS;
  const handleTreeNavigate = useCallback((id: string) => { navigateToNode(id); setTreeOpen(false); }, [navigateToNode]);

  const handleNavPage = useCallback((p: NavPage) => {
    clearSearch();
    startTransition(() => { navigate(NAV_PAGE_ROUTES[p]); });
  }, [navigate, clearSearch]);

  useEffect(() => {
    if (location !== ROUTES.ATLAS) setSplitId(null);
    setTreeOpen(false);
  }, [location]);

  return (
    <div className="flex flex-col h-dvh" style={{ background: "var(--bg)" }}>
      <SearchBar
        inputRef={inputRef} query={query} onChange={handleChange}
        ready={ready} isSearching={state.status === "searching"}
        onNavPage={handleNavPage}
        activePage={activeNavPage}
      />
      <div className="flex-1 flex overflow-hidden">
        {showTree && (
          <Drawer open={treeOpen} onClose={() => setTreeOpen(false)}>
            <TreeSidebar nodeId={nodeId} onNavigate={handleTreeNavigate} onShiftNavigate={setSplitId} />
          </Drawer>
        )}
        <div className="flex-1 flex flex-col overflow-hidden">
          {showTree && <DrawerToggle label="Atlas" onClick={() => setTreeOpen(true)} />}
          <Switch>
            <Route path={ROUTES.HOME}>
              {query.startsWith("__dev")
                ? <DevPanel query={query} onNavigate={navigateToNode} />
                : <SearchResults state={state} query={query} onNavigate={navigateToNode}
                    onNavigateEntity={navigateToEntity}
                    onHintClick={handleHintClick} />
              }
            </Route>
            <Route path={ROUTES.ATLAS}>
              <AtlasView
                id={nodeId ?? ""}
                onNavigate={navigateToNode}
                view={atlasView}
                onViewChange={handleViewChange}
                splitId={splitId}
                onSplitChange={setSplitId}
              />
            </Route>
            <Route path={ROUTES.REPORTS}><Suspense fallback={<Loading />}><ReportsIndex onNavigate={navigateToReport} /></Suspense></Route>
            <Route path={ROUTES.REPORTS_OF_RESPONSIBILITIES}><Suspense fallback={<Loading />}><OrgFacilitatorsReport onNavigate={navigateToNode} /></Suspense></Route>
            <Route path={ROUTES.REPORTS_ACTIVE_DATA}><Suspense fallback={<Loading />}><ActiveDataReport onNavigate={navigateToNode} /></Suspense></Route>
            <Route path={ROUTES.REPORTS_REWARDS}><Suspense fallback={<Loading />}><RewardsReport onNavigate={navigateToNode} onEntity={navigateToEntity} /></Suspense></Route>
            <Route path={ROUTES.CONSTELLATIONS}><Suspense fallback={<Loading />}><ConstellationsPage onNavigate={navigateToNode} query={query} /></Suspense></Route>
            <Route path={ROUTES.RADAR}><Suspense fallback={<Loading />}><RadarPage onNavigate={navigateToNode} /></Suspense></Route>
            <Route path={ROUTES.SEARCH_HINTS}><SearchHintsPage onHintClick={(q) => { navigate(ROUTES.HOME); setQuery(q); }} /></Route>
            <Route path={ROUTES.PROVENANCE}><Suspense fallback={<Loading />}><ProvenancePage /></Suspense></Route>
          </Switch>
        </div>
      </div>
      <Footer />
    </div>
  );
}
