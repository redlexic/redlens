import { memo } from "react";
import { chicletColor } from "../lib/depth";

interface Props {
  parts: string[];
  depths: number[];
}

export const DocNoChiclets = memo(function DocNoChiclets({ parts, depths }: Props) {
  return (
    <span className="atlas-chiclets">
      {parts.map((seg, i) => (
        <span
          key={`${i}:${seg}`}
          className="atlas-chiclet"
          style={{ ["--c" as string]: chicletColor(depths[i]) } as React.CSSProperties}
        >
          {seg}
        </span>
      ))}
    </span>
  );
});
