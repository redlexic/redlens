import type { NavPage } from "../lib/routes";

export interface NavBarProps {
  onNavPage: (page: NavPage) => void;
  activePage: NavPage | null;
}

export function NavBar({ activePage, onNavPage }: NavBarProps) {
  /* Nav links — row 1 right on mobile, row 1 right on desktop */
  return (
    <div className="order-2 sm:order-3 flex-1 flex items-center justify-end gap-2">
      <NavLink active={activePage === "atlas"} onClick={() => onNavPage("atlas")}>
        Reader
      </NavLink>
      <NavLink active={activePage === "constellations"} onClick={() => onNavPage("constellations")}>
        Constellations
      </NavLink>
      <NavLink active={activePage === "radar"} onClick={() => onNavPage("radar")}>
        Radar
      </NavLink>
      <NavLink active={activePage === "reports"} onClick={() => onNavPage("reports")}>
        Reports
      </NavLink>
    </div>
  );
}

export function NavLink({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="nav-link shrink-0 px-3 py-1.5 rounded text-sm"
      data-active={active ? "true" : undefined}
    >
      {children}
    </button>
  );
}
