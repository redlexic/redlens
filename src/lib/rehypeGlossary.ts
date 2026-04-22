import { visit } from "unist-util-visit";
import type { Root, Text, Element, ElementContent } from "hast";
import { getSharedLookup } from "./glossary";

// Capitalized contiguous run: one or more Capitalized words joined by single
// spaces. Sub-phrases are never tried — longest-match is enforced by only
// looking up the whole run.
const RUN_RE = /\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\b/g;

const SKIP_TAGS = new Set(["a", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);

export function rehypeGlossary(currentNodeId?: string) {
  return () => (tree: Root) => {
    const lookup = getSharedLookup();
    if (Object.keys(lookup).length === 0) return;

    const replacements: Array<{ parent: Element; index: number; nodes: ElementContent[] }> = [];

    visit(tree, "text", (node: Text, index, parent) => {
      if (index == null || !parent || parent.type !== "element") return;
      if (SKIP_TAGS.has((parent as Element).tagName)) return;

      const text = node.value;
      RUN_RE.lastIndex = 0;
      if (!RUN_RE.test(text)) return;
      RUN_RE.lastIndex = 0;

      const parts: ElementContent[] = [];
      let last = 0;
      let matched = false;

      let m: RegExpExecArray | null;
      while ((m = RUN_RE.exec(text)) !== null) {
        const run = m[0];
        const key = run.toLowerCase();
        const entries = lookup[key];
        if (!entries) continue;
        // Self-suppression: don't highlight a term inside its own definition node
        if (currentNodeId && entries.some((e) => e.nodeId === currentNodeId)) continue;

        matched = true;
        if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
        parts.push({
          type: "element",
          tagName: "span",
          properties: { className: ["glossary-term"], "data-term": key },
          children: [{ type: "text", value: run }],
        });
        last = m.index + run.length;
      }

      if (!matched) return;
      if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
      replacements.push({ parent: parent as Element, index, nodes: parts });
    });

    for (const { parent, index, nodes } of replacements.reverse()) {
      parent.children.splice(index, 1, ...nodes);
    }
  };
}
