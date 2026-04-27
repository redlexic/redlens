type Stage = {
  label: string;
  script: string;
  inputs: string[];
  outputs: { name: string; note?: string }[];
  powers: string[];
  verify: string;
};

const STAGES: Stage[] = [
  {
    label: "parse",
    script: "scripts/build-index.mjs",
    inputs: ["vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md"],
    outputs: [
      {
        name: "public/docs.json",
        note: "uuid → { doc_no, title, type, depth, parentId, content }",
      },
      { name: "public/search-index.json", note: "serialized lunr index, full-content" },
      {
        name: "public/addresses.merged.json",
        note: "intermediate; gitignored; handed to build:addresses",
      },
    ],
    powers: [
      "Full-text search (lunr in a Web Worker)",
      "Document viewing — every atlas node page, breadcrumbs, and UUID-to-UUID linking",
    ],
    verify:
      "Heading regex drives node extraction. Count: grep -c '<!-- UUID:' vendor/next-gen-atlas/Sky\\ Atlas/Sky\\ Atlas.md. Submodule SHA is pinned — see footer → atlas link.",
  },
  {
    label: "enrich addresses",
    script: "scripts/build-addresses.mjs",
    inputs: [
      "public/addresses.merged.json",
      "chainlog.skyeco.com/api/mainnet/active.json",
      "Etherscan v2 getsourcecode (cached)",
    ],
    outputs: [
      {
        name: "public/addresses.json",
        note: "labels, roles, aliases, expectedTokens. No ABIs ship to the frontend.",
      },
      { name: ".cache/etherscan/<chainid>/<addr>.json", note: "response cache; committed to git" },
    ],
    powers: [
      "Address cards in the annotations panel (entity labels, roles, aliases, explorer links)",
      "In-content address linkification via the rehype plugin in NodeContent",
    ],
    verify:
      "Cache is checked in — diff .cache/etherscan/ between commits to see what changed. Label priority: chainlog > atlas entityLabel > etherscan ContractName.",
  },
  {
    label: "snapshot chain state",
    script: "scripts/fetch-snapshots.mjs",
    inputs: [
      "public/addresses.json",
      ".cache/etherscan/*/*.json (ABIs)",
      "ETH_RPC_URL (defaults to ethereum.publicnode.com)",
    ],
    outputs: [
      {
        name: "public/chain-state.json",
        note: "{ generatedAt, block, values }. BigInts serialized as decimal strings.",
      },
    ],
    powers: [
      "Live on-chain view-function values pinned to a specific block",
      "Block pill in the footer — click through to the exact etherscan block",
    ],
    verify:
      "Footer shows block number + generatedAt. Every snapshot is a git commit — git blame surfaces drift at the line level.",
  },
  {
    label: "atlas history",
    script: "scripts/build-history.mjs",
    inputs: [
      "vendor/next-gen-atlas git log",
      "gh api repos/sky-ecosystem/next-gen-atlas (PR metadata, cached in .cache/github-prs/)",
    ],
    outputs: [
      {
        name: "public/history/<uuid>.json",
        note: "per-node change list; Atlas Edit Proposal PRs matched to nodes via bullet-title overlap",
      },
    ],
    powers: [
      "Per-document change timeline — toggle history on any atlas page (?view=history)",
      "Upstream commit + PR links for every change entry",
    ],
    verify:
      "Each entry links to the upstream sky-ecosystem commit and PR. Re-run the script to rebuild from scratch; output is deterministic given the same git + gh state.",
  },
  {
    label: "build graph",
    script: "redlens-mcp build-graph (feature branch; arriving on main soon)",
    inputs: [
      "vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md",
      "Parsing rules: .claude/skills/graph-atlas/",
    ],
    outputs: [
      {
        name: "public/atlas-graph.json",
        note: "full typed-edge graph: docs, agents & parties, instances, addresses, roles",
      },
      {
        name: "public/relations.json",
        note: "compacted/reduced projection of atlas-graph for runtime use",
      },
    ],
    powers: [
      "Constellations — visual graph of agents, facilitators, governance parties, and their relationships",
      "Graph-aware search and reports that join across the Sky ecosystem",
    ],
    verify:
      "Every edge carries source_doc_nos, so any relationship can be traced back to the atlas sections that establish it. Parsing rules are the graph-atlas skill.",
  },
];

const FRONTEND: { where: string; reads: string }[] = [
  {
    where: "src/lib/docs.ts",
    reads: "docs.json — module-level cache; every node view reads from here",
  },
  {
    where: "src/workers/search.worker.ts",
    reads: "docs.json + search-index.json — lunr queries off the main thread",
  },
  {
    where: "src/lib/addresses.ts",
    reads: "addresses.json — shared map; NodeContent rehype plugin resolves links against it",
  },
  {
    where: "src/components/Footer.tsx",
    reads: "chain-state.json — block pill + generatedAt tooltip",
  },
  {
    where: "src/lib/graph.ts + graph.worker.ts",
    reads: "relations.json — participants & instances; powers Constellations and reports",
  },
  {
    where: "src/components/atlas/HistoryView.tsx",
    reads: "public/history/<uuid>.json — on-demand per node",
  },
];

export function ProvenancePage() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">provenance</p>
        <h1 className="text-xl font-semibold mb-4" style={{ color: "var(--tan)" }}>
          Data flow &amp; provenance
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--tan-2)" }}>
          Everything in this app derives from a single source:{" "}
          <span className="mono">Sky&nbsp;Atlas.md</span>, pinned via git submodule at{" "}
          <span className="mono">vendor/next-gen-atlas/</span>. The exact commit is shown in the
          footer and links back to <span className="mono">sky-ecosystem/next-gen-atlas</span>. Every
          downstream artifact either lives in git or is reproducible from a single{" "}
          <span className="mono">pnpm build</span>.
        </p>

        {STAGES.map((s, i) => (
          <section key={s.label} className="mb-8">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="mono text-xs text-tan-3 w-4">{i + 1}.</span>
              <span className="mono text-xs text-tan-3 uppercase tracking-wider">{s.label}</span>
              <span className="mono text-sm" style={{ color: "var(--accent)" }}>
                {s.script}
              </span>
            </div>
            <div className="pl-7 space-y-2">
              <Row label="in" items={s.inputs} />
              <div className="flex gap-4">
                <span className="mono text-xs text-tan-3 w-14 shrink-0">out</span>
                <div className="space-y-1 flex-1">
                  {s.outputs.map((o) => (
                    <div key={o.name} className="text-xs">
                      <span className="mono" style={{ color: "var(--tan)" }}>
                        {o.name}
                      </span>
                      {o.note && <span style={{ color: "var(--tan-3)" }}> — {o.note}</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-4">
                <span className="mono text-xs text-tan-3 w-14 shrink-0">powers</span>
                <ul className="space-y-1 flex-1 text-xs" style={{ color: "var(--tan-2)" }}>
                  {s.powers.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-4">
                <span className="mono text-xs text-tan-3 w-14 shrink-0">verify</span>
                <p className="text-xs flex-1" style={{ color: "var(--tan-2)" }}>
                  {s.verify}
                </p>
              </div>
            </div>
          </section>
        ))}

        <h2 className="text-sm font-semibold mb-3 mt-10" style={{ color: "var(--tan)" }}>
          What the frontend does with it
        </h2>
        <div className="space-y-1 mb-8">
          {FRONTEND.map((f) => (
            <div key={f.where} className="flex gap-4 text-xs">
              <span className="mono shrink-0 w-64" style={{ color: "var(--accent)" }}>
                {f.where}
              </span>
              <span style={{ color: "var(--tan-2)" }}>{f.reads}</span>
            </div>
          ))}
        </div>

        <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--tan)" }}>
          End-to-end trace
        </h2>
        <p className="text-xs mb-8" style={{ color: "var(--tan-2)" }}>
          For any claim on this site the chain is: atlas commit (footer) →{" "}
          <span className="mono">Sky&nbsp;Atlas.md</span> heading with embedded UUID → parsed node
          in <span className="mono">docs.json</span> → rendered by{" "}
          <span className="mono">NodeContent</span>. Addresses additionally trace through{" "}
          <span className="mono">addresses.json</span> + the committed Etherscan cache. On-chain
          values trace through the block recorded in <span className="mono">chain-state.json</span>.
          Graph edges carry <span className="mono">source_doc_nos</span> pointing back to the
          sections that establish them.
        </p>

        <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--tan)" }}>
          Verify a node yourself
        </h2>
        <p className="text-xs mb-3" style={{ color: "var(--tan-2)" }}>
          Every node page shows a <span className="mono">sha256</span> under an{" "}
          <span className="mono">integrity</span> block. That hash is sha256 of the raw lines
          between the node's heading and the next heading in{" "}
          <span className="mono">Sky&nbsp;Atlas.md</span>. You can recompute it from a fresh clone —
          if it matches, redlens rendered exactly what the atlas says. If it doesn't, something is
          off.
        </p>
        <pre
          className="mono text-xs p-3 rounded overflow-x-auto mb-3"
          style={{
            background: "var(--surface)",
            color: "var(--tan-2)",
            border: "1px solid var(--border)",
          }}
        >
          {VERIFY_SCRIPT}
        </pre>
        <p className="text-xs mb-8" style={{ color: "var(--tan-3)" }}>
          The algorithm is the same one enforced by{" "}
          <span className="mono">tests/parser.test.ts</span> across all nodes on every build.
        </p>

        <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--tan)" }}>
          Build at any historical atlas commit
        </h2>
        <p className="text-xs mb-3" style={{ color: "var(--tan-2)" }}>
          The atlas is a moving target. To audit redlens against a specific atlas revision, check
          out the redlens repo and run:
        </p>
        <pre
          className="mono text-xs p-3 rounded overflow-x-auto mb-3"
          style={{
            background: "var(--surface)",
            color: "var(--tan-2)",
            border: "1px solid var(--border)",
          }}
        >
          {BUILD_AT_SCRIPT}
        </pre>
        <p className="text-xs mb-8" style={{ color: "var(--tan-3)" }}>
          Two people running the same command at the same atlas SHA get byte-identical{" "}
          <span className="mono">docs.json</span>, <span className="mono">search-index.json</span>,
          and <span className="mono">manifest.json</span>. CI enforces this on every push via{" "}
          <span className="mono">REPRO=1 pnpm test</span>.
        </p>
      </div>
    </div>
  );
}

const VERIFY_SCRIPT = `# 1. Copy the uuid shown under "integrity" on any node page.
UUID=<paste-uuid-here>

# 2. What redlens claims for that uuid:
jq -r ".[\\"$UUID\\"].contentHash" public/docs.json

# 3. Recompute it yourself from the atlas source:
node -e '
  const fs = require("fs"), crypto = require("crypto");
  const RE = /^#{1,6} [\\w.-]+ - .+? \\[[^\\]]+\\]\\s+<!-- UUID: ([0-9a-f-]{36}) -->$/;
  const src = fs.readFileSync("vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md", "utf8");
  const raw = {}; let cur = null;
  for (const l of src.split("\\n")) {
    const m = l.match(RE);
    if (m) { cur = m[1]; raw[cur] = []; }
    else if (cur) raw[cur].push(l);
  }
  console.log(crypto.createHash("sha256").update(raw[process.argv[1]].join("\\n")).digest("hex"));
' "$UUID"

# The two hashes should be identical.`;

const BUILD_AT_SCRIPT = `git clone --recurse-submodules https://github.com/<owner>/redlens.git
cd redlens
pnpm install --frozen-lockfile
pnpm build:at <atlas-commit-sha>   # e.g. ede66d5f2cf3…

# Prints the per-artifact sha256 and pins the manifest to the given atlas commit.
# No API keys needed — build:at only runs the deterministic, offline steps.`;

function Row({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex gap-4">
      <span className="mono text-xs text-tan-3 w-14 shrink-0">{label}</span>
      <div className="space-y-1 flex-1">
        {items.map((i) => (
          <div key={i} className="mono text-xs" style={{ color: "var(--tan-2)" }}>
            {i}
          </div>
        ))}
      </div>
    </div>
  );
}
