import { createContext, useContext, type ReactNode } from "react";
import type { AtlasNode } from "../../types";

interface RadarContextValue {
  docs: Record<string, AtlasNode>;
  /** Navigate to a doc in the atlas reader (UUID). */
  onNavigate: (id: string) => void;
  /** Select an actor by slug, optionally jumping to a section fragment. */
  onActor: (slug: string, fragment?: string) => void;
}

const RadarCtx = createContext<RadarContextValue | null>(null);

export function RadarProvider({ value, children }: { value: RadarContextValue; children: ReactNode }) {
  return <RadarCtx.Provider value={value}>{children}</RadarCtx.Provider>;
}

export function useRadar(): RadarContextValue {
  const v = useContext(RadarCtx);
  if (!v) throw new Error("useRadar must be used inside <RadarProvider>");
  return v;
}
