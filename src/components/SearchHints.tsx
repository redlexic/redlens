const HINTS: { label: string; query: string; description: string }[] = [
  {
    label: "prefix",
    query: "govern",
    description: "Partial words match automatically — type as you think",
  },
  { label: "0x address", query: "0x*", description: "All nodes containing an Ethereum address" },
  {
    label: "chainlog id",
    query: "MCD_VAT",
    description: "All nodes referencing a Sky chainlog contract",
  },
  { label: "doc number", query: "A.1.2", description: "Jump directly to a section by number" },
  {
    label: "exact phrase",
    query: '"properly implemented"',
    description: 'Case-insensitive literal phrase — only results containing this exact sequence',
  },
  {
    label: "case-sensitive",
    query: "'delegatedSigners'",
    description: "Single quotes — case-sensitive exact match",
  },
  {
    label: "field: title",
    query: "title:facilitator",
    description: "Search only in the title field",
  },
  { label: "field: type", query: "type:Annotation", description: "Filter by node type" },
  {
    label: "type (spaces)",
    query: "type:Scenario_Variation",
    description: 'Underscore for multi-word types, or quote: type:"Scenario Variation"',
  },
  {
    label: "scope",
    query: "in:A.1.2 delegate",
    description: "Restrict results to a section subtree",
  },
  { label: "fuzzy match", query: "misaligment~1", description: "~N allows N character edits" },
  {
    label: "exclude term",
    query: "alignment -slippery",
    description: "Prefix with - to exclude a term",
  },
  {
    label: "combine fields",
    query: "type:Core title:quorum",
    description: "Mix field filters and free text",
  },
];

const SLASH: { cmd: string; description: string }[] = [
  { cmd: "/reports", description: "Open the reports index" },
  { cmd: "/hints", description: "Open the search syntax reference" },
];

export function SearchHintsPage({ onHintClick }: { onHintClick: (q: string) => void }) {
  return (
    <main className="flex-1 overflow-y-auto">
      <SearchHints onSearch={onHintClick} />
    </main>
  );
}

export function SearchHints({
  onSearch,
  slashFilter,
}: {
  onSearch: (q: string) => void;
  slashFilter?: string | null;
}) {
  if (slashFilter !== null && slashFilter !== undefined) {
    const matches = SLASH.filter((s) => s.cmd.startsWith(slashFilter));
    return (
      <div className="px-4 py-8 max-w-2xl mx-auto">
        <p className="text-xs mono mb-3 text-tan-3">shortcuts</p>
        <div className="space-y-1">
          {matches.length > 0 ? (
            matches.map((s) => (
              <button
                key={s.cmd}
                onClick={() => onSearch(s.cmd)}
                className="hint-row w-full text-left flex items-baseline gap-4 px-3 py-2 rounded"
              >
                <span className="mono text-sm shrink-0 text-accent">{s.cmd}</span>
                <span className="text-xs text-tan-3">{s.description}</span>
              </button>
            ))
          ) : (
            <p className="text-xs mono text-tan-3 px-3">no matching slash commands</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-8 max-w-2xl mx-auto">
      <p className="text-xs mono mb-6 text-tan-3">search patterns</p>
      <div className="space-y-1 mb-8">
        {HINTS.map((h) => (
          <button
            key={h.query}
            onClick={() => onSearch(h.query)}
            className="hint-row w-full text-left flex items-baseline gap-4 px-3 py-2 rounded"
          >
            <span className="mono text-xs shrink-0 w-32 text-tan-3">{h.label}</span>
            <span className="mono text-sm shrink-0 text-accent">{h.query}</span>
            <span className="text-xs hidden sm:block text-tan-3">{h.description}</span>
          </button>
        ))}
      </div>
      <p className="text-xs mono mb-3 text-tan-3">shortcuts</p>
      <div className="space-y-1">
        {SLASH.map((s) => (
          <button
            key={s.cmd}
            onClick={() => onSearch(s.cmd)}
            className="hint-row w-full text-left flex items-baseline gap-4 px-3 py-2 rounded"
          >
            <span className="mono text-xs shrink-0 w-32 text-tan-3">slash</span>
            <span className="mono text-sm shrink-0 text-accent">{s.cmd}</span>
            <span className="text-xs hidden sm:block text-tan-3">{s.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
