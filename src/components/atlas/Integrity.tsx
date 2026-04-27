import type { AtlasNode } from "../../types";

export function Integrity({ node }: { node: AtlasNode | undefined }) {
  if (!node) return null;
  const BASE = import.meta.env.BASE_URL;
  return (
    <div className="mt-8 pt-4 border-t border-border">
      <p className="text-xs mono mb-2 text-tan-3">integrity</p>
      <div className="space-y-1 text-[10px] mono text-tan-3">
        <div>
          <span>doc_no: </span>
          <span className="text-tan-2">{node.doc_no}</span>
        </div>
        <div>
          <span>uuid: </span>
          <span className="break-all text-tan-2">{node.id}</span>
        </div>
        <div title="sha256 of the raw markdown between this heading and the next, at the pinned atlas commit">
          <span>sha256: </span>
          <span className="break-all text-tan-2">{node.contentHash}</span>
        </div>
        <div className="pt-1">
          <a href={`${BASE}provenance`} className="hover:underline text-accent">
            how to verify →
          </a>
        </div>
      </div>
    </div>
  );
}
