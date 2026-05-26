import { useRef, useCallback } from "react";

interface ResizeDragOptions {
  min: number;
  max: number;
  storageKey?: string;
  /** When true, dragging toward the left grows the panel (right-anchored panels).
   *  When false (default), dragging toward the right grows the panel (left-anchored panels). */
  growsLeft?: boolean;
}

export function useResizeDrag(
  width: number,
  setWidth: (w: number) => void,
  { min, max, storageKey, growsLeft = false }: ResizeDragOptions,
): React.MouseEventHandler {
  // Ref keeps current width readable inside the stable handler without adding
  // width to useCallback's dep array, which would recreate the handler on every
  // pixel of a drag and allocate mid-gesture closures.
  const widthRef = useRef(width);
  widthRef.current = width;

  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widthRef.current;
      let latest = startWidth;
      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const delta = growsLeft ? startX - ev.clientX : ev.clientX - startX;
        latest = Math.max(min, Math.min(max, startWidth + delta));
        setWidth(latest);
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
    },
    [min, max, storageKey, growsLeft, setWidth],
  );
}
