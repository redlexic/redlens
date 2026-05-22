import { memo, useState } from "react";
import { segmentDepths } from "../../lib/depth";
import { type FlatEntry } from "../../lib/atlasHelpers";
import { HEADER_OFFSET } from "../../lib/layout";
import { NodeContent } from "../NodeContent";

export const ViewChildrenFill = ({
  nodeId,
  docNo,
  onExpand,
}: {
  nodeId: string;
  docNo: string;
  onExpand: (id: string) => void;
}) => (
  <button
    type="button"
    onClick={() => onExpand(nodeId)}
    className="view-children-fill w-full text-center mono text-[10px] text-tan-3 bg-transparent cursor-pointer"
  >
    view all descendants of {docNo}
  </button>
);

const TITLE_CLASS = "text-xl font-bold";

const BORDER_WIDTH = 3;

export const CollapsibleNode = memo(function CollapsibleNode({
  entry,
  isSelected,
  isExpanded,
  hiddenCount = 0,
  fresh = false,
  parentDocNo,
  onExpandChildren,
  onNavigate,
  onToggle,
  onShiftNavigate,
  idPrefix,
}: {
  entry: FlatEntry;
  isSelected: boolean;
  isExpanded: boolean;
  hiddenCount?: number;
  fresh?: boolean;
  parentDocNo?: string;
  onExpandChildren?: (id: string) => void;
  onNavigate: (id: string) => void;
  onToggle: (id: string) => void;
  onShiftNavigate?: (id: string) => void;
  idPrefix?: string;
}) {
  const { node, depth, color, indentPadding, hasContent } = entry;
  const HeadingTag = `h${Math.min(depth, 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  // NR-X nodes are leaves attached to regular tree nodes. The doc_no is opaque
  // ("NR-2"), so derive the chiclet strip from the parent's path plus one
  // trailing chiclet for the NR itself — that way the chiclets reflect the
  // actual nesting position rather than the bare "NR-X" token.
  const isNR = node.doc_no.startsWith("NR-");
  const chicletSource = isNR && parentDocNo ? `${parentDocNo}.x` : node.doc_no;
  const docNoParts = chicletSource.split(".");
  const docNoDepths = chicletSource.startsWith("NR-") ? [1] : segmentDepths(chicletSource);
  const [copied, setCopied] = useState(false);
  const [docNoCopied, setDocNoCopied] = useState(false);

  const handleCopyUrl = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}${import.meta.env.BASE_URL}atlas?id=${node.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const handleCopyDocNo = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(node.doc_no).then(() => {
      setDocNoCopied(true);
      setTimeout(() => setDocNoCopied(false), 1200);
    });
  };

  const metaRow = (
    <div className="flex items-center gap-3 shrink-0">
      <span
        className="mono"
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--tan-3)",
          background: "var(--surface)",
          border: `1px solid ${isSelected ? "var(--tan)" : "var(--tan-2)"}`,
          borderRadius: 999,
          padding: "2px 8px",
          lineHeight: 1.4,
          whiteSpace: "nowrap",
        }}
      >
        {node.type}
      </span>
      <button
        type="button"
        onClick={handleCopyDocNo}
        title={docNoCopied ? "Copied!" : `Copy ${node.doc_no}`}
        className="mono text-[10px] cursor-pointer bg-transparent border-0 p-0 inline-flex items-center gap-1 shrink-0 hover:text-tan"
        style={{ color: docNoCopied ? "var(--accent)" : "var(--tan-3)" }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="7" height="7" rx="1" />
          <path d="M1 8V2C1 1.45 1.45 1 2 1H8" />
        </svg>
        <span style={{ display: "inline-grid" }}>
          <span style={{ gridArea: "1 / 1", visibility: docNoCopied ? "hidden" : "visible" }}>
            {node.doc_no}
          </span>
          <span style={{ gridArea: "1 / 1", visibility: docNoCopied ? "visible" : "hidden" }}>
            copied
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={handleCopyUrl}
        title={copied ? "Copied!" : `Copy link · ${node.id}`}
        className="mono text-[10px] cursor-pointer bg-transparent border-0 p-0 inline-flex items-center gap-1 shrink-0 hover:text-tan"
        style={{ color: copied ? "var(--accent)" : "var(--tan-3)" }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <span style={{ display: "inline-grid" }}>
          <span style={{ gridArea: "1 / 1", visibility: copied ? "hidden" : "visible" }}>
            {`${node.id.slice(0, 3)}…${node.id.slice(-3)}`}
          </span>
          <span style={{ gridArea: "1 / 1", visibility: copied ? "visible" : "hidden" }}>
            copied
          </span>
        </span>
      </button>
      <a
        href={`https://sky-atlas.io/#${node.id}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open on Sky Atlas"
        className="atlas-external-link shrink-0 inline-flex items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={`${import.meta.env.BASE_URL}sky.png`}
          alt=""
          aria-hidden="true"
          width={14}
          height={14}
          style={{ display: "block" }}
        />
      </a>
    </div>
  );

  return (
    <div
      id={idPrefix ? `${idPrefix}-${node.id}` : node.id}
      className={`atlas-node relative${fresh ? " atlas-node-fresh" : ""}${isSelected ? " is-selected" : ""}`}
      tabIndex={0}
      onClick={(e: React.MouseEvent) => {
        if ((e.target as Element).closest('a, button, [role="button"]')) return;
        // Drag-text-select fires a click on mouseup — skip those so selecting
        // a paragraph doesn't also toggle or navigate the row.
        if ((window.getSelection()?.toString().length ?? 0) > 0) return;
        const inRowBar = !!(e.target as Element).closest("[data-row-bar]");
        if (e.shiftKey && onShiftNavigate) {
          e.preventDefault();
          onShiftNavigate(node.id);
          return;
        }
        if (!isSelected) {
          // Click anywhere on the row (title or body) selects it.
          onNavigate(node.id);
          return;
        }
        // Already selected: only title-bar clicks toggle the body. Body clicks do nothing.
        if (inRowBar && hasContent) onToggle(node.id);
      }}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (isSelected && hasContent) {
            onToggle(node.id);
          } else {
            onNavigate(node.id);
          }
        }
      }}
      style={{
        padding: "4px 4px 4px 10px",
        borderRadius: 4,
        boxShadow: isSelected ? `inset 3px 0 0 color-mix(in srgb, ${color} 80%, white)` : undefined,
        borderBottom: hiddenCount > 0 ? "1px solid var(--border)" : undefined,
        scrollMarginTop: HEADER_OFFSET,
      }}
    >
      <div data-row-bar className="flex items-center gap-2">
        <span
          className="inline-flex items-center shrink-0"
          style={{
            fontFamily: '"Inter", system-ui, sans-serif',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.02em",
            color: "var(--tan-3)",
            userSelect: "none",
          }}
        >
          {docNoParts.map((seg, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                lineHeight: 1,
                flexShrink: 0,
                borderBottom: `3px solid ${
                  docNoDepths[i] === 0
                    ? "var(--gray)"
                    : `var(--depth-${Math.min(docNoDepths[i], 17)})`
                }`,
              }}
            >
              {seg}
            </span>
          ))}
        </span>
        <div className="atlas-node-title flex items-center gap-2 py-1.5 flex-1 min-w-0">
          <HeadingTag
            className={TITLE_CLASS}
            style={{ color: isSelected ? "var(--tan)" : "var(--tan-2)" }}
          >
            {node.title}
          </HeadingTag>
        </div>
      </div>
      <div className="atlas-node-meta">{metaRow}</div>

      {hiddenCount > 0 && onExpandChildren && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExpandChildren(node.id);
          }}
          title={`View ${hiddenCount} hidden ${hiddenCount === 1 ? "section" : "sections"} under ${node.doc_no}`}
          aria-label={`View ${hiddenCount} hidden sections`}
          className="view-children-affordance"
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            height: 14,
            padding: "0 6px",
            borderTop: "1px solid var(--border)",
            borderLeft: "1px solid var(--border)",
            borderRight: "none",
            borderBottom: "none",
            borderTopLeftRadius: 4,
            background: "var(--surface)",
            color: "var(--tan-3)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontFamily: '"Source Code Pro", "Courier New", monospace',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          <span>{hiddenCount} hidden</span>
          <svg
            width="8"
            height="5"
            viewBox="0 0 8 5"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M0 0 L8 0 L4 5 Z" />
          </svg>
        </button>
      )}
      {isExpanded && hasContent && (
        <div
          className="pb-3 mt-2"
          style={{
            // align body text with title text: title sits at content-x = toggle width (12) + gap-2 (8) = 20.
            marginLeft: 20,
          }}
        >
          <NodeContent content={node.content} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
});
