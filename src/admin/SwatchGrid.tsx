import { Swatch } from "./Swatch";
import type { PaletteToken } from "./palette-tokens";

interface SwatchGridProps {
  tokens: readonly PaletteToken[];
  effectiveValue: (name: string) => string;
  draft: Record<string, string>;
  onSwatchClick: (name: string) => void;
}

export function SwatchGrid({ tokens, effectiveValue, draft, onSwatchClick }: SwatchGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 10,
      }}
    >
      {tokens.map((token) => (
        <Swatch
          key={token.name}
          token={token}
          value={effectiveValue(token.name)}
          isOverridden={token.name in draft}
          onClick={() => onSwatchClick(token.name)}
        />
      ))}
    </div>
  );
}
