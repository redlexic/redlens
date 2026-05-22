import { memo, useRef, useState } from "react";
import { segmentDepths } from "../../lib/depth";
import { type FlatEntry } from "../../lib/atlasHelpers";
import { NodeContent } from "../NodeContent";

const DRAG_THRESHOLD_PX = 4;

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
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);

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
      <span className="atlas-type-pill">{node.type}</span>
      <button
        type="button"
        onClick={handleCopyDocNo}
        title={docNoCopied ? "Copied!" : `Copy ${node.doc_no}`}
        className="atlas-copy-btn"
        data-copied={docNoCopied ? "true" : undefined}
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
        <span className="atlas-copy-flip" data-flipped={docNoCopied ? "true" : undefined}>
          <span className="label">{node.doc_no}</span>
          <span className="flipped">copied</span>
        </span>
      </button>
      <button
        type="button"
        onClick={handleCopyUrl}
        title={copied ? "Copied!" : `Copy link · ${node.id}`}
        className="atlas-copy-btn"
        data-copied={copied ? "true" : undefined}
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
        <span className="atlas-copy-flip" data-flipped={copied ? "true" : undefined}>
          <span className="label">{`${node.id.slice(0, 3)}…${node.id.slice(-3)}`}</span>
          <span className="flipped">copied</span>
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
          className="block"
        />
      </a>
    </div>
  );

  return (
    <div
      id={idPrefix ? `${idPrefix}-${node.id}` : node.id}
      className={`atlas-node relative${fresh ? " atlas-node-fresh" : ""}${isSelected ? " is-selected" : ""}`}
      data-has-hidden={hiddenCount > 0 ? "true" : undefined}
      style={{ ["--row-color" as string]: color } as React.CSSProperties}
      tabIndex={0}
      onMouseDown={(e: React.MouseEvent) => {
        mouseDownRef.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e: React.MouseEvent) => {
        if ((e.target as Element).closest('a, button, [role="button"]')) return;
        // Drag-text-select fires a click on mouseup — skip those so selecting
        // a paragraph doesn't also toggle or navigate the row.
        const down = mouseDownRef.current;
        mouseDownRef.current = null;
        if (down) {
          const dx = Math.abs(e.clientX - down.x);
          const dy = Math.abs(e.clientY - down.y);
          if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) return;
        }
        // inRowBar = click landed on the title row (chiclets/title), not the expanded body. See data-row-bar attr below.
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
    >
      {/* data-row-bar: marker the outer onClick uses to distinguish title-bar clicks from body clicks (see handler above). */}
      <div data-row-bar className="flex items-center gap-2">
        <span className="atlas-chiclets">
          {docNoParts.map((seg, i) => {
            const c =
              docNoDepths[i] === 0
                ? "var(--gray)"
                : `var(--depth-${Math.min(docNoDepths[i], 17)})`;
            return (
              <span
                key={i}
                className="atlas-chiclet"
                style={{ ["--c" as string]: c } as React.CSSProperties}
              >
                {seg}
              </span>
            );
          })}
        </span>
        <div className="atlas-node-title flex items-center gap-2 py-1.5 flex-1 min-w-0">
          <HeadingTag className={TITLE_CLASS}>
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
        <div className="atlas-node-body">
          <NodeContent content={node.content} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
});
