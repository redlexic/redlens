import { useEffect, useState } from "react";

export const ROW_PULSE_MS = (() => {
  if (typeof window === "undefined") return 700; // keep in sync with --row-pulse-ms
  const v = getComputedStyle(document.documentElement).getPropertyValue("--row-pulse-ms").trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 700;
})();

export function usePulseOnChange<T extends string | number | null | undefined>(
  value: T,
  ms: number,
): T | null {
  const [pulse, setPulse] = useState<T | null>(null);
  useEffect(() => {
    if (value === null || value === undefined) return;
    setPulse(value);
    const t = setTimeout(() => setPulse(null), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return pulse;
}
