import { memo } from "react";
import { depthColor } from "../../lib/depth";
import { type FlatEntry } from "../../lib/atlasHelpers";
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

const DEPTH_HEADING: Record<number, string> = {
  1: "text-2xl font-bold",
  2: "text-xl font-bold",
  3: "text-lg font-bold",
  4: "text-base font-semibold",
  5: "text-sm font-semibold",
  6: "text-sm font-semibold",
  7: "text-sm font-medium",
  8: "text-sm font-medium",
  9: "text-xs font-medium",
  10: "text-xs font-medium",
  11: "text-xs font-normal",
  12: "text-xs font-normal",
};

const BORDER_WIDTH = 3;

export const CollapsibleNode = memo(function CollapsibleNode({
  entry,
  isSelected,
  isExpanded,
  onNavigate,
  onToggle,
  onShiftNavigate,
  idPrefix,
}: {
  entry: FlatEntry;
  isSelected: boolean;
  isExpanded: boolean;
  onNavigate: (id: string) => void;
  onToggle: (id: string) => void;
  onShiftNavigate?: (id: string) => void;
  idPrefix?: string;
}) {
  const { node, depth, color, indentPadding, hasContent } = entry;

  return (
    <div
      id={idPrefix ? `${idPrefix}-${node.id}` : node.id}
      className="atlas-node relative"
      tabIndex={0}
      onClick={(e: React.MouseEvent) => {
        if ((e.target as Element).closest('a, button, [role="button"]')) return;
        if (e.shiftKey && onShiftNavigate) {
          e.preventDefault();
          onShiftNavigate(node.id);
        } else {
          onNavigate(node.id);
        }
      }}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(node.id);
        }
      }}
      style={{
        padding: 4,
        boxShadow: isSelected ? `inset ${BORDER_WIDTH}px 0 0 ${color}` : undefined,
        borderTop: isSelected ? `${BORDER_WIDTH}px solid ${color}` : undefined,
        scrollMarginTop: "64px",
      }}
    >
      {depth > 1 && (
        <span className="absolute flex items-center" style={{ left: BORDER_WIDTH + 4, top: 4 }}>
          {Array.from({ length: depth }, (_, i) => (
            <span
              key={i}
              style={{
                width: 4,
                textAlign: "center",
                color: depthColor(i + 1),
                fontSize: i === depth - 1 ? 11 : 8,
                lineHeight: 1,
              }}
            >
              {"\u2022"}
            </span>
          ))}
        </span>
      )}
      <div
        className="flex items-center gap-2"
        style={{ paddingLeft: isSelected ? indentPadding - BORDER_WIDTH : indentPadding }}
      >
        <span
          role={hasContent ? "button" : undefined}
          tabIndex={hasContent ? 0 : undefined}
          aria-expanded={hasContent ? isExpanded : undefined}
          aria-label={hasContent ? `Toggle ${node.title}` : undefined}
          className="atlas-toggle text-[11px] w-3 text-center shrink-0"
          style={{ color: hasContent ? "var(--tan-3)" : "transparent", display: "inline-flex" }}
          onClick={
            hasContent
              ? (e: React.MouseEvent) => {
                  e.stopPropagation();
                  onToggle(node.id);
                }
              : undefined
          }
          onKeyDown={
            hasContent
              ? (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggle(node.id);
                  }
                }
              : undefined
          }
        >
          {hasContent ? (isExpanded ? "\u25BE" : "\u25B8") : "\u00B7"}
        </span>
        <div className="atlas-node-title flex items-center gap-2 py-1.5">
          <span
            className={DEPTH_HEADING[depth] ?? "text-sm font-medium"}
            style={{ color: isSelected ? "var(--tan)" : "var(--tan-2)" }}
          >
            {node.title}
          </span>
          <span className="text-[10px] mono text-tan-3">{node.id}</span>
        </div>
      </div>

      {isExpanded && hasContent && (
        <div
          className="pb-3 mt-2"
          style={{
            // ensure at least 7 px are to the left
            marginLeft: Math.max(
              (isSelected ? indentPadding - BORDER_WIDTH : indentPadding) + 7,
              7,
            ),
            boxShadow: `inset 1px 0 0 var(--border)`,
            paddingLeft: 18,
          }}
        >
          <div className="flex items-center gap-3 mb-2">
            <span
              className="text-[11px] font-medium px-1.5 py-0.5 rounded mono"
              style={{
                background: "var(--surface)",
                color,
                border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
              }}
            >
              {node.type}
            </span>
            <span className="mono text-[10px] shrink-0" style={{ color }}>
              {node.doc_no}
            </span>
            <a
              href={`https://sky-atlas.io/#${node.id}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open on Sky Atlas"
              className="atlas-external-link shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M4.5 1.5H2a.5.5 0 00-.5.5v8a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V7.5" />
                <path d="M7 1.5h3.5V5M7 5.5l4-4" />
              </svg>
            </a>
          </div>
          <NodeContent content={node.content} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
});
