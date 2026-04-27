import { useState, useEffect, useCallback, startTransition, lazy, Suspense } from "react";
import { useLocation, useSearchParams, Switch, Route } from "wouter";
import { useSearchInput } from "./hooks/useSearchInput";
import { useNavigation } from "./hooks/useNavigation";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { AtlasView } from "./components/atlas/AtlasView";
import { TreeSidebar } from "./components/tree/TreeSidebar";
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

  const nodeId = location === "/atlas" ? searchParams.get("id") : null;
  const atlasView = searchParams.get("view") === "history" ? "history" as const : "annotations" as const;
  const activeNavPage = location.startsWith("/constellations") ? "constellations"
    : location.startsWith("/reports") ? "reports"
    : location.startsWith("/radar") ? "radar"
    : null;

  const { query, setQuery, inputRef, handleChange, state, ready, clearSearch, handleHintClick } = useSearchInput(location, navigate);
  const { navigateToNode, navigateToEntity, navigateToReport, handleViewChange } = useNavigation({ navigate, clearSearch, nodeId });

  const handleNavPage = useCallback((p: string) => {
    clearSearch();
    startTransition(() => { navigate(`/${p}`); });
  }, [navigate, clearSearch]);

  useEffect(() => {
    if (location !== "/atlas") setSplitId(null);
  }, [location]);

  return (
    <div className="flex flex-col h-dvh" style={{ background: "var(--bg)" }}>
      <SearchBar
        inputRef={inputRef} query={query} onChange={handleChange}
        ready={ready} isSearching={state.status === "searching"}
        onNavPage={handleNavPage}
        activePage={activeNavPage as "reports" | "constellations" | "radar" | null}
      />
      <div className="flex-1 flex overflow-hidden">
        {location !== "/constellations" && !location.startsWith("/radar") && <TreeSidebar nodeId={nodeId} onNavigate={navigateToNode} onShiftNavigate={setSplitId} />}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Switch>
            <Route path="/">
              {query.startsWith("__dev")
                ? <DevPanel query={query} onNavigate={navigateToNode} />
                : <SearchResults state={state} query={query} onNavigate={navigateToNode}
                    onNavigateEntity={navigateToEntity}
                    onHintClick={handleHintClick} />
              }
            </Route>
            <Route path="/atlas">
              <AtlasView
                id={nodeId ?? ""}
                onNavigate={navigateToNode}
                view={atlasView}
                onViewChange={handleViewChange}
                splitId={splitId}
                onSplitChange={setSplitId}
              />
            </Route>
            <Route path="/reports"><Suspense fallback={<Loading />}><ReportsIndex onNavigate={navigateToReport} /></Suspense></Route>
            <Route path="/reports/of-responsibilities"><Suspense fallback={<Loading />}><OrgFacilitatorsReport onNavigate={navigateToNode} /></Suspense></Route>
            <Route path="/reports/active-data"><Suspense fallback={<Loading />}><ActiveDataReport onNavigate={navigateToNode} /></Suspense></Route>
            <Route path="/reports/rewards"><Suspense fallback={<Loading />}><RewardsReport onNavigate={navigateToNode} onEntity={navigateToEntity} /></Suspense></Route>
            <Route path="/constellations"><Suspense fallback={<Loading />}><ConstellationsPage onNavigate={navigateToNode} query={query} /></Suspense></Route>
            <Route path="/radar"><Suspense fallback={<Loading />}><RadarPage onNavigate={navigateToNode} /></Suspense></Route>
            <Route path="/search-hints"><SearchHintsPage onHintClick={(q) => { navigate("/"); setQuery(q); }} /></Route>
            <Route path="/provenance"><Suspense fallback={<Loading />}><ProvenancePage /></Suspense></Route>
          </Switch>
        </div>
      </div>
      <Footer />
    </div>
  );
}
