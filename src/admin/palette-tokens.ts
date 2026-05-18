export type PaletteGroup =
  | "surface"
  | "brand"
  | "text"
  | "row"
  | "shadow"
  | "graph"
  | "diff"
  | "entity"
  | "depth";

export interface PaletteToken {
  name: string;
  label: string;
  group: PaletteGroup;
  alpha: boolean;
  defaultValue: string;
}

export const GROUP_ORDER: readonly PaletteGroup[] = [
  "surface",
  "brand",
  "text",
  "row",
  "shadow",
  "graph",
  "diff",
  "entity",
  "depth",
] as const;

export const GROUP_LABEL: Record<PaletteGroup, string> = {
  surface: "Surface",
  brand: "Brand",
  text: "Text",
  row: "Row Overlays",
  shadow: "Shadows",
  graph: "Graph Chrome",
  diff: "Diff",
  entity: "Entity Types",
  depth: "Depth Rainbow",
};

export const PALETTE_TOKENS: readonly PaletteToken[] = [
  // ─── Surface ───
  { name: "bg", label: "Background", group: "surface", alpha: false, defaultValue: "#160e0d" },
  { name: "bg-deep", label: "Deep BG", group: "surface", alpha: false, defaultValue: "#0e0907" },
  { name: "surface", label: "Surface", group: "surface", alpha: false, defaultValue: "#221614" },
  { name: "hover", label: "Hover", group: "surface", alpha: false, defaultValue: "#3a1f1a" },
  { name: "border", label: "Border", group: "surface", alpha: false, defaultValue: "#3d2c28" },

  // ─── Brand ───
  { name: "red", label: "Red", group: "brand", alpha: false, defaultValue: "#a63228" },
  { name: "red-dim", label: "Red Dim", group: "brand", alpha: false, defaultValue: "#753021" },
  { name: "accent", label: "Accent", group: "brand", alpha: false, defaultValue: "#c67267" },

  // ─── Text ───
  { name: "gray", label: "Gray", group: "text", alpha: false, defaultValue: "#9a8a80" },
  { name: "tan", label: "Tan (primary)", group: "text", alpha: false, defaultValue: "#f3e7ce" },
  { name: "tan-2", label: "Tan 2", group: "text", alpha: false, defaultValue: "#e4d1b9" },
  { name: "tan-3", label: "Tan 3", group: "text", alpha: false, defaultValue: "#b8a48e" },

  // ─── Row overlays (alpha) ───
  { name: "row-hover", label: "Row Hover", group: "row", alpha: true, defaultValue: "rgba(255, 255, 255, 0.1)" },
  { name: "row-selected", label: "Row Selected", group: "row", alpha: true, defaultValue: "rgba(255, 255, 255, 0.08)" },
  { name: "row-focused", label: "Row Focused", group: "row", alpha: true, defaultValue: "rgba(255, 255, 255, 0.04)" },

  // ─── Shadows (alpha) ───
  { name: "shadow", label: "Shadow", group: "shadow", alpha: true, defaultValue: "rgba(0, 0, 0, 0.3)" },
  { name: "shadow-strong", label: "Shadow Strong", group: "shadow", alpha: true, defaultValue: "rgba(0, 0, 0, 0.5)" },

  // ─── Graph chrome ───
  { name: "edge", label: "Edge", group: "graph", alpha: false, defaultValue: "#5a3a32" },
  { name: "edge-label-fg", label: "Edge Label", group: "graph", alpha: false, defaultValue: "#8a6a60" },
  { name: "graph-dots", label: "Graph Dots", group: "graph", alpha: false, defaultValue: "#2a1a16" },

  // ─── Diff ───
  { name: "diff-removed-bg", label: "Diff Removed BG", group: "diff", alpha: false, defaultValue: "#4a1010" },
  { name: "diff-removed-fg", label: "Diff Removed FG", group: "diff", alpha: false, defaultValue: "#e8d5d5" },

  // ─── Entity types ───
  { name: "entity-agent", label: "Agent", group: "entity", alpha: false, defaultValue: "#c67267" },
  { name: "entity-facilitator-org", label: "Facilitator", group: "entity", alpha: false, defaultValue: "#e0a060" },
  { name: "entity-govops-org", label: "GovOps", group: "entity", alpha: false, defaultValue: "#8fb8c2" },
  { name: "entity-delegate-org", label: "Aligned Delegate", group: "entity", alpha: false, defaultValue: "#9ab58a" },
  { name: "entity-development-company", label: "Dev Company", group: "entity", alpha: false, defaultValue: "#a0b0d0" },
  { name: "entity-foundation", label: "Foundation", group: "entity", alpha: false, defaultValue: "#b8a0c8" },
  { name: "entity-composite-party", label: "Composite Party", group: "entity", alpha: false, defaultValue: "#c8b070" },
  { name: "entity-governance-body", label: "Governance Body", group: "entity", alpha: false, defaultValue: "#90a880" },
  { name: "entity-operational-party", label: "Operational Party", group: "entity", alpha: false, defaultValue: "#c09080" },
  { name: "entity-ecosystem-actor", label: "Ecosystem Actor", group: "entity", alpha: false, defaultValue: "#a89090" },
  { name: "entity-instance", label: "Instance", group: "entity", alpha: false, defaultValue: "#7a8a9c" },
  { name: "entity-fallback", label: "Fallback", group: "entity", alpha: false, defaultValue: "#888888" },

  // ─── Depth rainbow (7-color R O Y G B P M, cycled across 17) ───
  { name: "depth-1", label: "Depth 1 (red)", group: "depth", alpha: false, defaultValue: "#f43545" },
  { name: "depth-2", label: "Depth 2 (orange)", group: "depth", alpha: false, defaultValue: "#fb923c" },
  { name: "depth-3", label: "Depth 3 (yellow)", group: "depth", alpha: false, defaultValue: "#facc15" },
  { name: "depth-4", label: "Depth 4 (green)", group: "depth", alpha: false, defaultValue: "#4ade80" },
  { name: "depth-5", label: "Depth 5 (blue)", group: "depth", alpha: false, defaultValue: "#3b82f6" },
  { name: "depth-6", label: "Depth 6 (purple)", group: "depth", alpha: false, defaultValue: "#a855f7" },
  { name: "depth-7", label: "Depth 7 (magenta)", group: "depth", alpha: false, defaultValue: "#ec4899" },
  { name: "depth-8", label: "Depth 8 (red)", group: "depth", alpha: false, defaultValue: "#f43545" },
  { name: "depth-9", label: "Depth 9 (orange)", group: "depth", alpha: false, defaultValue: "#fb923c" },
  { name: "depth-10", label: "Depth 10 (yellow)", group: "depth", alpha: false, defaultValue: "#facc15" },
  { name: "depth-11", label: "Depth 11 (green)", group: "depth", alpha: false, defaultValue: "#4ade80" },
  { name: "depth-12", label: "Depth 12 (blue)", group: "depth", alpha: false, defaultValue: "#3b82f6" },
  { name: "depth-13", label: "Depth 13 (purple)", group: "depth", alpha: false, defaultValue: "#a855f7" },
  { name: "depth-14", label: "Depth 14 (magenta)", group: "depth", alpha: false, defaultValue: "#ec4899" },
  { name: "depth-15", label: "Depth 15 (red)", group: "depth", alpha: false, defaultValue: "#f43545" },
  { name: "depth-16", label: "Depth 16 (orange)", group: "depth", alpha: false, defaultValue: "#fb923c" },
  { name: "depth-17", label: "Depth 17 (yellow)", group: "depth", alpha: false, defaultValue: "#facc15" },
] as const;

export const TOKEN_BY_NAME: ReadonlyMap<string, PaletteToken> = new Map(
  PALETTE_TOKENS.map((t) => [t.name, t]),
);
