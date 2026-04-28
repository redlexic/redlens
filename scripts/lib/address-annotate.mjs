/**
 * Per-address annotation: roles, entity labels, expected tokens.
 *
 * Three independent passes per address:
 *   1. roles          — multi-label tags from a closed vocabulary
 *   2. entityLabel    — best-effort proper-noun phrase pulled from preceding text
 *   3. expectedTokens — text-derived guess at which ERC20s this address holds
 *
 * Roles, labeling, and holder detection are deliberately separate concerns.
 */

import { annotationWindow } from "./address-chains.mjs";

// Closed-vocabulary role tags. Each address collects every tag whose pattern
// fires within the annotation window. Categories below are organizational only — the
// emitted tags are flat strings.
const ROLE_VOCAB = {
  // --- Affiliation (only emitted on a positive signal; no default) ---
  // "sky" only fires for proper-noun Sky entities, NOT bare mentions of "Sky"
  // (which appear in nearly every Atlas node and would be useless).
  sky: [
    /\bSky\s+(?:Frontier|Foundation|Ecosystem|Token|Governance|Star|Council|Aligned|Atlas|Operator)\b/,
    /\bAligned\s+Delegate\b/i,
  ],
  spark: [/\bSpark(?:Lend|FI)?\b/],
  maker: [/\bMaker(?:DAO)?\b/],
  grove: [/\bGrove\b/],
  // Safe Harbor is a Sky-adopted onchain agreement (A.2.11.1.2), NOT external.
  // LayerZero is infrastructure Sky uses, not a Sky-external entity — Sky's
  // LayerZero-adjacent multisigs are Sky-controlled, so "LayerZero" nearby
  // shouldn't flip an address to external.
  external: [
    /\bChainlink\b/i,
    /\bUniswap\b/i,
    /\bAave\b/i,
    /\bCurve\b/i,
    /\bMorpho\b/i,
    /\bGnosis\s+Safe\b/i,
  ],

  // --- Wallet type ---
  multisig: [/\bmulti-?sig\b/i],
  subproxy: [/\bsub-?proxy\b/i],
  "hot-wallet": [/\bhot[- ]wallet\b/i],

  // --- Contract type ---
  // proxy uses negative lookbehind to avoid double-matching with subproxy
  proxy: [/\b(?<!sub-?)proxy\b/i],
  registry: [/\bregistry\b/i],
  oracle: [/\boracle\b/i, /\bprice[- ]feed\b/i],

  // --- Purpose ---
  treasury: [/\btreasury\b/i],
  buffer: [/\bbuffer\b/i],
  reserve: [/\breserves?\b/i],
  vesting: [/\bvesting\b/i],
  vault: [/\bvault\b/i],
  foundation: [/\bfoundation\b/i],
  "incentive-pool": [/\bincentive\s+pool\b/i],
  "staking-rewards": [/\bstaking\s+rewards?\b/i],

  // --- Signer / governance ---
  signer: [/\bsigner\b/i],
  delegate: [/\bdelegate\b/i],
  executor: [/\bexecutor\b/i],
  controller: [/\bcontroller\b/i],
};

// Tokens we can plausibly query via viem. Case-sensitive — sUSDS / stUSDS are
// distinct from USDS, and we want to preserve the canonical casing.
const TOKEN_SYMBOLS = [
  "USDS",
  "DAI",
  "SKY",
  "MKR",
  "sUSDS",
  "stUSDS",
  "USDC",
  "ETH",
  "WETH",
  "SPK",
  "GROVE",
];

const TOKEN_RE = new RegExp(
  `\\b(${TOKEN_SYMBOLS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "g",
);

// Entity label patterns — try to pull a proper-noun phrase near the address
// Each captures group 1 = the entity name
const ENTITY_PATTERNS = [
  // "address of the X is" / "address of X is"
  /\baddress\s+of\s+(?:the\s+)?([A-Z][A-Za-z0-9 .&'’-]{2,60}?)\s+(?:is|on|at)\b/,
  // "the X address is" / "X's address is"
  /\b(?:the\s+)?([A-Z][A-Za-z0-9 .&'’-]{2,60}?)['’]?s?\s+address\s+(?:is|on)\b/,
  // "reward address for (the) X is" (Integration Boost / partner phrasing)
  /\breward\s+address\s+for\s+(?:the\s+)?([A-Z][A-Za-z0-9 .&'’-]{2,60}?)\s+is\b/,
  // "X at address"
  /\b([A-Z][A-Za-z0-9 .&'’-]{2,60}?)\s+at\s+address\b/,
  // "Recipient: X" / "Multisig: X"
  /\b(?:Recipient|Multisig|Operator|Owner|Controller|Executor)\s*[:-]\s*([A-Z][A-Za-z0-9 .&'’-]{2,60})/,
  // Markdown bold/italic name immediately followed by colon: **X:** or *X:*
  /\*\*([A-Z][A-Za-z0-9 .&'’-]{2,60}?)\*\*\s*[:-]/,
];

// Combined text for pattern scanning: the sliding window plus any table cells
// and headers (if the address lives in a table). Lets role/token regex see
// header words that would otherwise be far outside ANNOT_WINDOW.
function annotationText(content, matchIndex, addrLength, table) {
  let text = annotationWindow(content, matchIndex, addrLength);
  if (table) {
    if (table.headers.length) text += "\n" + table.headers.join(" | ");
    text += "\n" + table.cells.join(" | ");
  }
  return text;
}

// Tags that mean "this address belongs to a Sky-ecosystem org"
const SKY_ALIGNED_TAGS = new Set(["sky", "spark", "grove", "maker"]);

export function extractRoles(content, matchIndex, addrLength, table) {
  const text = annotationText(content, matchIndex, addrLength, table);
  let tags = [];
  for (const [tag, patterns] of Object.entries(ROLE_VOCAB)) {
    if (patterns.some((p) => p.test(text))) tags.push(tag);
  }
  // "external" means outside the Sky system — mutually exclusive with any
  // Sky-aligned tag. If both fire, the Sky-aligned signal wins.
  if (tags.includes("external") && tags.some((t) => SKY_ALIGNED_TAGS.has(t))) {
    tags = tags.filter((t) => t !== "external");
  }
  return tags;
}

// Column-header keywords that suggest the cell contains a human-readable name
// for the row's subject.
const LABEL_HEADER_KEYWORDS = [
  "name",
  "label",
  "entity",
  "description",
  "role",
  "party",
  "who",
  "organization",
  "contract",
  "subject",
  "details",
  "purpose",
];

function cleanCellLabel(cell) {
  // Strip common markdown wrapping and escape-chars from a cell value
  return cell
    .replace(/^\*\*(.*?)\*\*$/, "$1")
    .replace(/^__(.*?)__$/, "$1")
    .replace(/^\[([^\]]+)\]\([^)]*\)$/, "$1") // strip markdown links
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeAddress(val) {
  return /^0x[0-9a-fA-F]{40}$/.test(val) || /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(val);
}
function looksLikeNumber(val) {
  return /^[0-9.,%$]+$/.test(val);
}

export function extractEntityLabel(content, matchIndex, table) {
  // Pass 1: prose patterns in the 200 chars immediately preceding the address
  const start = Math.max(0, matchIndex - 200);
  const before = content.slice(start, matchIndex);

  for (const re of ENTITY_PATTERNS) {
    const m = before.match(re);
    if (m && m[1]) {
      const label = m[1].trim().replace(/\s+/g, " ");
      if (label.length >= 3 && !/^(The|This|That|These|Those|It)$/i.test(label)) {
        return label;
      }
    }
  }

  // Pass 2: if the address sits in a markdown table row, use sibling cells
  if (table) {
    const { cells, headers, columnIndex } = table;

    // 2a: prefer a cell whose header contains a label-ish keyword
    for (let i = 0; i < cells.length; i++) {
      if (i === columnIndex) continue;
      const hdr = (headers[i] || "").toLowerCase();
      if (LABEL_HEADER_KEYWORDS.some((k) => hdr.includes(k))) {
        const val = cleanCellLabel(cells[i]);
        if (val.length >= 3 && !looksLikeAddress(val) && !looksLikeNumber(val)) {
          return val;
        }
      }
    }

    // 2b: fall back to the first sibling cell that isn't an address / number / empty
    for (let i = 0; i < cells.length; i++) {
      if (i === columnIndex) continue;
      const val = cleanCellLabel(cells[i]);
      if (val.length >= 3 && !looksLikeAddress(val) && !looksLikeNumber(val)) {
        return val;
      }
    }
  }

  return null;
}

// Text-derived guess at which ERC20s this address should hold. Independent of
// roles — an address with no role tags can still have expectedTokens (and vice
// versa). The plan is to use this list to drive viem balanceOf() calls.
export function extractExpectedTokens(content, matchIndex, addrLength, table) {
  const text = annotationText(content, matchIndex, addrLength, table);
  const found = new Set();
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    found.add(m[1]);
  }
  return [...found];
}
