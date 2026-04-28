export const ROUTES = {
  HOME: "/",
  ATLAS: "/atlas",
  RADAR: "/radar",
  CONSTELLATIONS: "/constellations",
  SEARCH_HINTS: "/search-hints",
  PROVENANCE: "/provenance",
  REPORTS: "/reports",
  REPORTS_OF_RESPONSIBILITIES: "/reports/of-responsibilities",
  REPORTS_ACTIVE_DATA: "/reports/active-data",
  REPORTS_REWARDS: "/reports/rewards",
} as const;

export type NavPage = "atlas" | "constellations" | "radar" | "reports";

export const NAV_PAGE_ROUTES: Record<NavPage, string> = {
  atlas: ROUTES.ATLAS,
  constellations: ROUTES.CONSTELLATIONS,
  radar: ROUTES.RADAR,
  reports: ROUTES.REPORTS,
};

export type SearchScope = "atlas" | "constellations" | "radar" | "reports";

export const SCOPE_CONFIG: Record<SearchScope, { label: string; placeholder: string }> = {
  atlas:          { label: "atlas",         placeholder: "Search the Atlas or type /hints for query help" },
  constellations: { label: "constellation", placeholder: "Filter constellation — name, type" },
  radar:          { label: "radar",         placeholder: "Filter actors — name, role" },
  reports:        { label: "reports",       placeholder: "Filter reports" },
};
