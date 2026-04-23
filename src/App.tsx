import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useLocation, useSearchParams, Switch, Route } from "wouter";
import { useSearch } from "./hooks/useSearch";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { AtlasView } from "./components/atlas/AtlasView";
import { TreeSidebar } from "./components/tree/TreeSidebar";
import { prefetchNodeContent } from "./components/NodeContent";
import { Loading } from "./components/Loading";
import { SearchHintsPage } from "./components/SearchHints";
import { DevPanel } from "./DevPanel";
import { Footer } from "./components/Footer";

// Secondary routes — lazy so xyflow/graphology/report code stays out of the
// initial bundle. Initial search/atlas load only pulls what it needs.
const ConstellationsPage = lazy(() => import("./components/ConstellationsPage").then(m => ({ default: m.ConstellationsPage })));
const OFReport = lazy(() => import("./components/reports/OFReport").then(m => ({ default: m.OFReport })));
const ActiveDataReport = lazy(() => import("./components/reports/ActiveDataReport").then(m => ({ default: m.ActiveDataReport })));
const RewardsReport = lazy(() => import("./components/reports/RewardsReport").then(m => ({ default: m.RewardsReport })));
const ReportsIndex = lazy(() => import("./components/ReportsIndex").then(m => ({ default: m.ReportsIndex })));
const ProvenancePage = lazy(() => import("./components/ProvenancePage").then(m => ({ default: m.ProvenancePage })));

export type ReportId = "of-responsibilities" | "active-data" | "rewards";

prefetchNodeContent();

export default function App() {
  const [location, navigate] = useLocation();
  const { state, search, ready } = useSearch();
  const [query, setQuery] = useState("");
  const [splitId, setSplitId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (location !== "/atlas") setSplitId(null);
  }, [location]);

  // nodeId and view derived reactively from URL search params via wouter
  const [searchParams] = useSearchParams();
  const nodeId = location === "/atlas" ? searchParams.get("id") : null;
  const atlasView = searchParams.get("view") === "history" ? "history" as const : "annotations" as const;

  useEffect(() => {
    if (location === "/" && !nodeId) inputRef.current?.focus();
  }, [location, nodeId]);

  const navigateToNode = useCallback((id: string) => {
    navigate(`/atlas?id=${id}`);
    setQuery(""); search("");
  }, [navigate, search]);

  const navigateToEntity = useCallback((id: string) => {
    navigate(`/constellations?id=${id}`);
    setQuery(""); search("");
  }, [navigate, search]);

  const navigateToReport = useCallback((id: ReportId) => {
    navigate(`/reports/${id}`);
    setQuery(""); search("");
  }, [navigate, search]);

  const handleViewChange = useCallback((v: "annotations" | "history") => {
    const params = new URLSearchParams();
    if (nodeId) params.set("id", nodeId);
    if (v === "history") params.set("view", "history");
    navigate(`/atlas?${params}`);
  }, [navigate, nodeId]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;

    if (q === "/reports") { navigate("/reports"); setQuery(""); search(""); return; }
    if (q === "/hints")   { navigate("/search-hints"); setQuery(""); search(""); return; }

    setQuery(q);

    // On /constellations, typing filters the graph in-place — no lunr, no nav.
    if (location === "/constellations") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      search("");
      return;
    }

    if (location !== "/") navigate("/");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.startsWith("/")) {
      search("");
    } else {
      debounceRef.current = setTimeout(() => search(q), 200);
    }
  }, [location, navigate, search]);

  const activeNavPage = location.startsWith("/constellations") ? "constellations"
    : location.startsWith("/reports") ? "reports"
    : null;

  return (
    <div className="flex flex-col h-dvh" style={{ background: "var(--bg)" }}>
      <SearchBar
        inputRef={inputRef} query={query} onChange={handleChange}
        ready={ready} isSearching={state.status === "searching"}
        onNavPage={(p) => { navigate(`/${p}`); setQuery(""); search(""); }}
        activePage={activeNavPage as "reports" | "constellations" | null}
      />
      <div className="flex-1 flex overflow-hidden">
        {location !== "/constellations" && <TreeSidebar nodeId={nodeId} onNavigate={navigateToNode} onShiftNavigate={setSplitId} />}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Switch>
            <Route path="/">
              {query.startsWith("__dev")
                ? <DevPanel query={query} onNavigate={navigateToNode} />
                : <SearchResults state={state} query={query} onNavigate={navigateToNode}
                    onNavigateEntity={navigateToEntity}
                    onHintClick={(q) => { setQuery(q); search(q); }} />
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
            <Route path="/reports/of-responsibilities"><Suspense fallback={<Loading />}><OFReport onNavigate={navigateToNode} /></Suspense></Route>
            <Route path="/reports/active-data"><Suspense fallback={<Loading />}><ActiveDataReport onNavigate={navigateToNode} /></Suspense></Route>
            <Route path="/reports/rewards"><Suspense fallback={<Loading />}><RewardsReport onNavigate={navigateToNode} onEntity={navigateToEntity} /></Suspense></Route>
            <Route path="/constellations"><Suspense fallback={<Loading />}><ConstellationsPage onNavigate={navigateToNode} query={query} /></Suspense></Route>
            <Route path="/search-hints"><SearchHintsPage onHintClick={(q) => { navigate("/"); setQuery(q); search(q); }} /></Route>
            <Route path="/provenance"><Suspense fallback={<Loading />}><ProvenancePage /></Suspense></Route>
          </Switch>
        </div>
      </div>
      <Footer />
    </div>
  );
}
