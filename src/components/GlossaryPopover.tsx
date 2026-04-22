import { useState, useEffect, useCallback } from "react";
import { getSharedGlossary } from "../lib/glossary";
import type { GlossaryEntry } from "../lib/glossary";

interface PopoverState {
  term: string;
  entries: GlossaryEntry[];
}

/** Single shared fixed popover — mounted once in NodeDetail, shown on
 *  pointer-enter of any .glossary-term span via event delegation. */
export function GlossaryPopover({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const [pop, setPop] = useState<PopoverState | null>(null);

  const show = useCallback((term: string) => {
    const glossary = getSharedGlossary();
    const entries = glossary[term];
    if (entries?.length) setPop({ term, entries });
  }, []);

  const hide = useCallback(() => setPop(null), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onEnter = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest(".glossary-term");
      if (target instanceof HTMLElement) {
        show(target.dataset.term ?? "");
      }
    };
    const onLeave = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest(".glossary-term");
      if (target) hide();
    };

    el.addEventListener("mouseover", onEnter);
    el.addEventListener("mouseout", onLeave);
    return () => {
      el.removeEventListener("mouseover", onEnter);
      el.removeEventListener("mouseout", onLeave);
    };
  }, [containerRef, show, hide]);

  if (!pop) return null;

  return (
    <div className="glossary-popover">
      <p className="glossary-popover-term">{pop.entries[0].term}</p>
      {pop.entries.map((e, i) => (
        <div key={i} className={i > 0 ? "glossary-popover-entry-divider" : ""}>
          {pop.entries.length > 1 && e.sourceContext && (
            <p className="glossary-popover-source">{e.sourceContext}</p>
          )}
          <p className="glossary-popover-content">{e.content}</p>
        </div>
      ))}
    </div>
  );
}
