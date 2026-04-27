export const ROUTES = {
  HOME:                        "/",
  ATLAS:                       "/atlas",
  RADAR:                       "/radar",
  CONSTELLATIONS:              "/constellations",
  SEARCH_HINTS:                "/search-hints",
  PROVENANCE:                  "/provenance",
  REPORTS:                     "/reports",
  REPORTS_OF_RESPONSIBILITIES: "/reports/of-responsibilities",
  REPORTS_ACTIVE_DATA:         "/reports/active-data",
  REPORTS_REWARDS:             "/reports/rewards",
} as const;

export type NavPage = "atlas" | "constellations" | "radar" | "reports";

export const NAV_PAGE_ROUTES: Record<NavPage, string> = {
  atlas:          ROUTES.ATLAS,
  constellations: ROUTES.CONSTELLATIONS,
  radar:          ROUTES.RADAR,
  reports:        ROUTES.REPORTS,
};
  