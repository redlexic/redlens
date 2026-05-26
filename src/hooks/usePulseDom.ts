import { useEffect } from "react";
import type { RefObject } from "react";
import { ROW_PULSE_MS } from "./usePulseOnChange";

// Toggles `is-pulse` on the tree row matching `[data-node-id="${nodeId}"]` via
// direct DOM classList mutation rather than React state. Keeping nodeId out of
// the rowProps useMemo dependency array prevents react-window from re-rendering
// all visible rows twice per navigation — once when the class is added and once
// ROW_PULSE_MS later when it is removed.
export function usePulseDom(
  nodeId: string | null,
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!nodeId) return;
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
    if (!el) return;
    el.classList.add("is-pulse");
    const timer = setTimeout(() => el.classList.remove("is-pulse"), ROW_PULSE_MS);
    return () => {
      clearTimeout(timer);
      el.classList.remove("is-pulse");
    };
  }, [nodeId, containerRef]);
}
