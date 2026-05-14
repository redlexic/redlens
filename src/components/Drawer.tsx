import { useState, useEffect } from "react";
import { HEADER_OFFSET } from "../lib/layout";

function useIsNarrow(maxWidth: number) {
  const [narrow, setNarrow] = useState(() => window.innerWidth < maxWidth);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", handler);
    setNarrow(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, [maxWidth]);
  return narrow;
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  breakpoint?: number;
  width?: number;
  /** Desktop layout. "static" keeps the sidebar in flex flow (fixed-shell
   *  routes). "sticky" pins it to the viewport below the header so it stays
   *  visible while the window scrolls (window-scroll routes). */
  desktopMode?: "static" | "sticky";
  children: React.ReactNode;
}

export function Drawer({
  open,
  onClose,
  breakpoint = 1050,
  width = 220,
  desktopMode = "static",
  children,
}: DrawerProps) {
  const isDrawer = useIsNarrow(breakpoint);
  const desktopStyle: React.CSSProperties =
    desktopMode === "sticky"
      ? {
          position: "sticky",
          top: HEADER_OFFSET,
          alignSelf: "flex-start",
          height: `calc(100vh - ${HEADER_OFFSET}px)`,
          width,
          flexShrink: 0,
          background: "var(--bg)",
        }
      : { width, flexShrink: 0, background: "var(--bg)" };
  return (
    <>
      {isDrawer && open && <div className="fixed inset-0 z-20 bg-black/40" onClick={onClose} />}
      <div
        style={
          isDrawer
            ? {
                position: "fixed",
                top: 0,
                bottom: 0,
                left: 0,
                zIndex: 30,
                width,
                background: "var(--bg)",
                transform: open ? "translateX(0)" : "translateX(-100%)",
                transition: "transform 200ms",
              }
            : desktopStyle
        }
      >
        {children}
      </div>
    </>
  );
}

export function DrawerToggle({
  label,
  onClick,
  breakpoint = 1050,
}: {
  label: string;
  onClick?: () => void;
  breakpoint?: number;
}) {
  const isDrawer = useIsNarrow(breakpoint);
  if (!isDrawer) return null;
  return (
    <div className="shrink-0 px-1 py-1">
      <button
        onClick={onClick}
        className="mono text-xs px-1 py-1 rounded border"
        style={{ color: "var(--tan-3)", borderColor: "var(--hover)" }}
      >
        ☰ {label}
      </button>
    </div>
  );
}
