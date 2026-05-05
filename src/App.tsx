import { useState, useEffect, useCallback, startTransition, lazy, Suspense } from "react";
import { useLocation, useSearchParams, Switch, Route } from "wouter";
import { useSearchInput } from "./hooks/useSearchInput";
import { useNavigation } from "./hooks/useNavigation";
import { ROUTES, NAV_PAGE_ROUTES, type NavPage, type SearchScope } from "./lib/routes";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { AtlasView } from "./components/atlas/AtlasView";
import { TreeSidebar } from "./components/tree/TreeSidebar";
import { Drawer } from "./components/Drawer";
import { prefetchNodeContent } from "./components/NodeContent";
import { Loading } from "./components/Loading";
import { SearchHintsPage } from "./components/SearchHints";
import { HomePage } from "./components/HomePage";
import { DevPanel } from "./DevPanel";
import { Footer } from "./components/Footer";
import { ErrorBoundary, PanelError } from "./components/ErrorBoundary";

// Retries a failed dynamic import once before propagating the error.
// Silently handles transient "Failed to fetch dynamically imported module"
// errors that occur when a chunk isn't cached yet on first navigation.
function lazyRetry<T>(factory: () => Promise<T>): Promise<T> {
  return factory().catch(() => factory());
}

const ConstellationsPage = lazy(() =>
  lazyRetry(() => import("./components/ConstellationsPage")).then((m) => ({ default: m.ConstellationsPage })),
);
const OpFacilitatorsReport = lazy(() =>
  lazyRetry(() => import("./components/reports/OpFacilitatorsReport")).then((m) => ({ default: m.OFReport })),
);
const ActiveDataReport = lazy(() =>
  lazyRetry(() => import("./components/reports/ActiveDataReport")).then((m) => ({ default: m.ActiveDataReport })),
);
const RewardsReport = lazy(() =>
  lazyRetry(() => import("./components/reports/RewardsReport")).then((m) => ({ default: m.RewardsReport })),
);
const ReportsIndex = lazy(() =>
  lazyRetry(() => import("./components/ReportsIndex")).then((m) => ({ default: m.ReportsIndex })),
);
const ProvenancePage = lazy(() =>
  lazyRetry(() => import("./components/ProvenancePage")).then((m) => ({ default: m.ProvenancePage })),
);
const RadarPage = lazy(() =>
  lazyRetry(() => import("./components/radar/RadarPage")).then((m) => ({ default: m.RadarPage })),
);

prefetchNodeContent();

export default function App() {
  const [location, navigate] = useLocation();
  const [searchParams] = useSearchParams();
  const [splitId, setSplitId] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);

  const nodeId = location === ROUTES.ATLAS ? searchParams.get("id") : null;
  const atlasView =
    searchParams.get("view") === "history"
      ? ("history" as const)
      : searchParams.get("view") === "glossary"
        ? ("glossary" as const)
        : ("annotations" as const);
  const activeNavPage: NavPage | null = location.startsWith(ROUTES.CONSTELLATIONS)
    ? "constellations"
    : location.startsWith(ROUTES.REPORTS)
      ? "reports"
      : location.startsWith(ROUTES.RADAR)
        ? "radar"
        : location.startsWith(ROUTES.ATLAS)
          ? "atlas"
          : null;

  const scope: SearchScope = activeNavPage ?? "atlas";

  const { query, setQuery, inputRef, handleChange, state, ready, clearSearch, handleHintClick } =
    useSearchInput(location, navigate, scope);
  const { navigateToNode, navigateToEntity, navigateToReport, handleViewChange } = useNavigation({
    navigate,
    clearSearch,
    nodeId,
  });

  const showTree =
    location === ROUTES.HOME || location === ROUTES.ATLAS || location === ROUTES.SEARCH_HINTS;
  const handleTreeNavigate = useCallback(
    (id: string) => {
      navigateToNode(id);
      setTreeOpen(false);
    },
    [navigateToNode],
  );

  const handleNavPage = useCallback(
    (p: NavPage) => {
      clearSearch();
      startTransition(() => {
        navigate(NAV_PAGE_ROUTES[p]);
      });
    },
    [navigate, clearSearch],
  );

  useEffect(() => {
    if (location !== ROUTES.ATLAS) setSplitId(null);
    setTreeOpen(false);
  }, [location]);

  return (
    <div className="flex flex-col h-dvh" style={{ background: "var(--bg)" }}>
      <SearchBar
        inputRef={inputRef}
        query={query}
        onChange={handleChange}
        ready={ready}
        isSearching={state.status === "searching"}
        onNavPage={handleNavPage}
        activePage={activeNavPage}
        scope={scope}
      />
      <div className="flex-1 flex overflow-hidden">
        {showTree && (
          <ErrorBoundary fallback={<PanelError />}>
            <Drawer open={treeOpen} onClose={() => setTreeOpen(false)}>
              <TreeSidebar
                nodeId={nodeId}
                onNavigate={handleTreeNavigate}
                onShiftNavigate={setSplitId}
              />
            </Drawer>
          </ErrorBoundary>
        )}
        <div className="flex-1 flex flex-col overflow-hidden">
          <ErrorBoundary
            key={location}
            fallback={(error) => (
              <div className="flex flex-col items-center justify-center flex-1 py-24 gap-4">
                <p className="text-sm mono" style={{ color: "var(--red)" }}>page failed to load</p>
                <p className="text-xs mono text-tan-3 text-center max-w-md">{error.message}</p>
              </div>
            )}
          >
          <Switch>
            <Route path={ROUTES.HOME}>
              {query.startsWith("__dev") ? (
                <DevPanel query={query} onNavigate={navigateToNode} />
              ) : query ? (
                <SearchResults
                  state={state}
                  query={query}
                  onNavigate={navigateToNode}
                  onNavigateEntity={navigateToEntity}
                  onHintClick={handleHintClick}
                />
              ) : (
                <HomePage onNavPage={handleNavPage} />
              )}
            </Route>
            <Route path={ROUTES.ATLAS}>
              <AtlasView
                id={nodeId ?? ""}
                onNavigate={navigateToNode}
                view={atlasView}
                onViewChange={handleViewChange}
                splitId={splitId}
                onSplitChange={setSplitId}
                onOpenTree={() => setTreeOpen(true)}
              />
            </Route>
            <Route path={ROUTES.REPORTS}>
              <Suspense fallback={<Loading />}>
                <ReportsIndex onNavigate={navigateToReport} query={query} />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_OF_RESPONSIBILITIES}>
              <Suspense fallback={<Loading />}>
                <OpFacilitatorsReport onNavigate={navigateToNode} />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_ACTIVE_DATA}>
              <Suspense fallback={<Loading />}>
                <ActiveDataReport onNavigate={navigateToNode} />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_REWARDS}>
              <Suspense fallback={<Loading />}>
                <RewardsReport onNavigate={navigateToNode} onEntity={navigateToEntity} />
              </Suspense>
            </Route>
            <Route path={ROUTES.CONSTELLATIONS}>
              <Suspense fallback={<Loading />}>
                <ConstellationsPage onNavigate={navigateToNode} query={query} />
              </Suspense>
            </Route>
            <Route path={ROUTES.RADAR_ACTOR}>
              {(params: { slug: string }) => (
                <Suspense fallback={<Loading />}>
                  <RadarPage actorSlug={params.slug} onNavigate={navigateToNode} query={query} />
                </Suspense>
              )}
            </Route>
            <Route path={ROUTES.RADAR}>
              <Suspense fallback={<Loading />}>
                <RadarPage onNavigate={navigateToNode} query={query} />
              </Suspense>
            </Route>
            <Route path={ROUTES.SEARCH_HINTS}>
              <SearchHintsPage
                onHintClick={(q) => {
                  navigate(ROUTES.HOME);
                  setQuery(q);
                }}
              />
            </Route>
            <Route path={ROUTES.PROVENANCE}>
              <Suspense fallback={<Loading />}>
                <ProvenancePage />
              </Suspense>
            </Route>
          </Switch>
          </ErrorBoundary>
        </div>
      </div>
      <Footer />
    </div>
  );
}
