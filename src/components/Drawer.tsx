import { useState, useEffect } from "react";

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
  resizable?: boolean;
  minWidth?: number;
  maxWidth?: number;
  storageKey?: string;
  children: React.ReactNode;
}

export function Drawer({
  open,
  onClose,
  breakpoint = 1050,
  width = 220,
  resizable = false,
  minWidth = 180,
  maxWidth = 600,
  storageKey,
  children,
}: DrawerProps) {
  const isDrawer = useIsNarrow(breakpoint);

  const [currentWidth, setCurrentWidth] = useState(() => {
    if (!resizable || !storageKey) return width;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= minWidth && n <= maxWidth) return n;
      }
    } catch {}
    return width;
  });

  const effectiveWidth = isDrawer || !resizable ? width : currentWidth;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = currentWidth;
    let latest = startWidth;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      latest = Math.max(minWidth, Math.min(maxWidth, startWidth + delta));
      setCurrentWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, String(latest));
        } catch {}
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const showHandle = resizable && !isDrawer;

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
                width: effectiveWidth,
                background: "var(--bg)",
                transform: open ? "translateX(0)" : "translateX(-100%)",
                transition: "transform 200ms",
              }
            : {
                width: effectiveWidth,
                flexShrink: 0,
                background: "var(--bg)",
                position: "relative",
              }
        }
      >
        {children}
        {showHandle && (
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              right: -3,
              width: 6,
              cursor: "col-resize",
              zIndex: 10,
            }}
          />
        )}
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
