---
name: graph-atlas
description: >
  Knowledge base for the RedLens Atlas graph schema. Use when writing or
  modifying scripts/build-graph.mjs, designing edge types, querying
  the Atlas MCP for relationships, reading raw Atlas markdown to understand
  doc_no patterns, or reviewing Atlas PRs for new structural conventions.
  Covers Atlas document numbering rules, the heading depth cap (parentId
  unreliability), primitive hub structure, entity extraction patterns, the
  role-as-edge vocabulary, composite accord parties, and auditable provenance
  requirements.
  Keywords: graph, atlas, doc_no, edge, entity, primitive, instance, role, facilitator, govops, prime agent, executor agent, composite party, build-graph, relations.json
license: MIT
metadata:
  author: anscharo
  version: "1.6"
---

# graph-atlas

**Source of truth for Atlas document structure:** `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md`
Read that file before making any changes to graph extraction logic. This skill summarises what we've learned and must stay in sync with it.

**This skill should be updated** whenever a new relationship pattern is discovered in the Atlas — through reading the markdown, using the MCP tools, or noticing a structural convention not yet captured here. Add it under the appropriate section with an Atlas source reference (doc_no or UUID).

---

## Terminology

| Term | Meaning |
|---|---|
| **doc** | An Atlas Document — has `uuid`, `doc_no`, `title`, `type`, `content`. The Atlas calls these "Documents". Do not call them "nodes" (that is a graph term). |
| **entity** | A named real-world actor extracted from Atlas content (agent, foundation, dev company, facilitator org, delegate, ecosystem concept, etc.) |
| **address** | An on-chain address (EVM or Solana) |
| **edge** | A typed, auditable relationship between docs, entities, and/or addresses |

**Auditable edge requirement:** Every edge MUST carry `source_doc_nos` — a JSON array of the doc_nos that establish the relationship. Without provenance, an edge cannot be shown to users or cited in reports.

### Foundational Atlas definitions (keep verbatim)

> Agents are first-class economic citizens of Sky that autonomously pursue business opportunities. Each Agent has its own Agent Artifact and token. Initially, the creation of an Agent results in a **Proto-Agent**, which lacks any specialized role. To gain functionality within the Sky ecosystem, a Proto-Agent must deploy a special **Transformation Primitive** to transform into a specific Agent sub-type. The Agent sub-types currently defined in the Atlas include 1) **Prime Agent** and 2) **Executor Agent**, with the Executor Agent sub-type further divided into **Operational Executor Agents** and **Core Executor Agents**.
>
> Although Executor Agents are not yet operational, the Atlas nonetheless defines the foundational rules, processes, and governance structures necessary for their eventual activation. In the medium to long term, these Executor Agents will become fully operative and perform an essential function in facilitating the activities of Prime Agents across the Sky ecosystem.

**Role-as-edge principle.** "Spark is Prime Agent **for** Sky Ecosystem" is bilateral — the role describes a relationship between two entities. Roles therefore live on edges (`prime_agent_for`, `operational_executor_agent_for`, `operational_facilitator_for`, etc.), not on the entity's type. An entity's `entity_type` captures its broad kind (agent, foundation, facilitator_org); its obligations and relationships are expressed via edges. Atlas verb: "Ozone serves as the Operational Executor Agent **for** {Prime Agent}" (A.2.8.2.9.2.1.2).

### The "Sky" concept layers

The atlas distinguishes several "Sky" concepts. Do not collapse the named legal entities.

| Atlas term | Role | entity_type | Becomes target of |
|---|---|---|---|
| ~~Sky Ecosystem~~ | Scope that regulates Agents (A.6). **Editorial: collapsed into `sky-core`** — see Editorial Decisions. | — (not emitted) | — |
| **Sky Core** | Operational party representing "Sky" in every Ecosystem Accord (verbatim "The party 'Sky' comprises Sky Core" in 8 accords). Also serves as the target for `prime_agent_for` edges. | `operational_party` | `prime_agent_for`, `ecosystem_accord` (as party), `comprises` (inbound) |
| **Sky Governance** | Decision body that selects delegates and approves spells | `governance_body` | `aligned_delegate_for`, `ranked_delegate_for` |
| **Sky Frontier Foundation** | Legal entity; grant recipient (A.2.13.1.1; address `0xca5183FB9997046fbd9bA8113139bf5a5Af122A0`) | `foundation` | normal entity edges |
| **Sky Fortification Foundation** | Legal entity; grant recipient (A.2.13.1.2) | `foundation` | normal entity edges |

**"Sky Foundation" does not exist in the atlas.** Be specific with names.

---

## Atlas Document Numbering

*From `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md` §8*

### Doc_no patterns by type

| Type | Pattern | Example |
|---|---|---|
| Scope | `A.{N}` | `A.1`, `A.2` |
| Article | `{Scope}.{N}` | `A.1.1` |
| Section | `{Article}.{N}` or `{Section}.{N}` | `A.1.1.1` |
| Core | `{Section}.{N}` (nestable arbitrarily) | `A.1.1.1.1` |
| Type Specification | `{Section}.{N}` | `A.1.2.2.2.1` |
| Active Data Controller | `{Section}.{N}` | `A.1.1.3.1` |
| Annotation | `{Target}.0.3.{N}` | `A.1.12.1.2.0.3.1` |
| Action Tenet | `{Target}.0.4.{N}` | `A.1.4.5.0.4.1` |
| Scenario | `{Tenet}.1.{N}` | `A.1.4.5.0.4.1.1.1` |
| Scenario Variation | `{Scenario}.var{N}` | `A.1.4.5.0.4.1.1.1.var1` |
| Active Data | `{Controller}.0.6.{N}` | `A.1.1.3.1.0.6.1` |
| Needed Research | `NR-{N}` (global) | `NR-5` |

### Special directory numbers

- `.0.3` = Element Annotation Directory
- `.0.4` = Facilitator Tenet Annotation Directory
- `.0.6` = Active Data Directory
- `.1` = Facilitator Scenario Directory

### Semantic depth vs heading level — CRITICAL for graph extraction

**Semantic depth** = `doc_no.split(".").length - 1` (segments after "A").

**Heading level** = `min(semantic_depth, 6)`. The Atlas markdown caps at `######` (6 hashtags).

**Consequence for `parentId` in `docs.json`:** The parser uses a heading-level stack. When a doc at semantic depth > 6 is encountered, it still gets `######`. Its `parentId` is set to whatever was last seen at heading level 5 — the nearest depth-5 ancestor — NOT its true semantic parent.

**Rule:**
- `doc_no.split(".").length <= 7` (semantic depth ≤ 6): `parentId` is reliable
- `doc_no.split(".").length > 7` (semantic depth > 6): `parentId` jumps to nearest depth-5 ancestor. **Use doc_no arithmetic instead.**

**Examples of the depth cap breaking parentId:**
- `A.6.1.1.1.2.1.1.1.1` (9 parts, depth 8) → `parentId = A.6.1.1.1.2` (Sky Primitives, not Hub Document)
- All ICDs, Hub Documents, Global Activation Status docs under Sky Primitives are affected

**Helper functions for build-graph.mjs:**
```javascript
function semanticParent(doc) {
  if (doc.doc_no.split(".").length <= 7) return docById.get(doc.parentId); // reliable
  const parts = doc.doc_no.split(".");
  return docByDocNo.get(parts.slice(0, -1).join(".")) ?? null;
}
function ancestorByStripping(doc, n) {
  const parts = doc.doc_no.split(".");
  return docByDocNo.get(parts.slice(0, -n).join(".")) ?? null;
}
```

---

## Entity Types (Atlas-confirmed)

Every entity type below either has a defining Atlas doc number pattern, or is bootstrapped because it's the target of a role edge with no single defining doc.

| entity_type | subtype | How to identify |
|---|---|---|
| `agent` | `proto` | Pre-Transformation-Primitive Agent. Reserved — no named instances yet. |
| `agent` | `prime` | Direct child of `A.6.1.1` (List Of Prime Agent Artifacts) |
| `agent` | `operational_executor` | Direct child of `A.6.1.2` whose title starts `"Operational Executor Agent "` |
| `agent` | `core_executor` | Direct child of `A.6.1.2` whose title starts `"Core Council Executor Agent "` |
| `composite_party` | — | Entity named as a party in `A.2.8.2.Y.1.1.N` (Ecosystem Accord party details). Holds treaty-level identity; its members are resolved via `comprises`. |
| `foundation` | — | Named `"X Foundation"` — in party-comprises lists (e.g. Spark Foundation) or grant recipients (Sky Frontier Foundation, Sky Fortification Foundation) |
| `development_company` | — | Third slot in party-comprises lists. Examples: Phoenix Labs, Elodin, Treadstone, Stablewatch, Rubicon, "Development Company" |
| `operational_party` | — | Bootstrapped: **Sky Core** (also serves as the target of `prime_agent_for`; see Editorial Decisions) |
| `governance_body` | — | Bootstrapped: **Sky Governance** |
| `facilitator_org` | — | Named in `"The (Operational\|Core) Facilitator for {Executor} is {Name}."` |
| `govops_org` | — | Named in `"(Operational\|Core) GovOps for {Executor} is {Name}."` |
| `delegate_org` | — | Named in the Aligned Delegates list (`A.1.5.1.5.0.6.1`) or Ranked Delegates list (`A.1.5.4.1.{L}.3.1`); also `addresses.json` entries with `roles: ["delegate"]` |
| `ecosystem_actor` | — | Catch-all: named actors surfaced by patterns that don't fit a more specific kind (ERG members, role-binding holders, etc.) |
| `instance` | `<primitive-slug>` | Primitive Instance Configuration Document. Entity id = ICD doc UUID. Emitted for every in-scope primitive (see Pattern 14 for the allowlist). `st` is the primitive slug (`distribution-reward`, `integration-boost`, `allocation-system`, etc.). |

**Halo Agents** are mentioned in `A.6.1.1.5.1` as a future category but have no structural pattern yet — do not classify.

**Key principle:** Key on doc_no position first, then title shape. Never on names alone — agent names change.

---

## Doc Number Patterns for Relationship Extraction

### Pattern 1: Prime Agent artifacts

```
A.6.1.1.X            {Agent Name}           ← Prime Agent (direct child of A.6.1.1)
A.6.1.1.X.1          Introduction
A.6.1.1.X.2          Sky Primitives         ← all primitive instances live here
A.6.1.1.X.3          Omni Documents

A.6.1.2.Y            {Executor Name}        ← Executor Agent (direct child of A.6.1.2)
A.6.1.2.Y.1          Facilitator doc        ← names the Facilitator entity
A.6.1.2.Y.2          GovOps doc             ← names the GovOps entity
```

Every Prime Agent emits `prime_agent_for`: `entity(prime) → entity(Sky Core)`, source: `[A.6.1.1.X]`.

**Editorial:** the atlas phrasing is "Prime Agent for the Sky Ecosystem". We collapse the target onto `sky-core` rather than creating a separate `sky-ecosystem` entity — see Editorial Decisions.

### Pattern 2: Sky Primitives within an Agent

Each primitive under `A.6.1.1.X.2` follows this structure. Position `.2.Z` does **not** indicate primitive category — derive from the `See [...]` citation to `A.2.2`.

```
A.6.1.1.X.2.Z              {Primitive Name}      ← primitive root; cites global def in A.2.2
A.6.1.1.X.2.Z.1            Primitive Hub Document
A.6.1.1.X.2.Z.1.1          Global Activation Status
A.6.1.1.X.2.Z.1.2          Active Instances Directory
A.6.1.1.X.2.Z.1.2.N        {Name} ICD Location   ← pointer (may also be .1.3.N or .1.4.N)
A.6.1.1.X.2.Z.1.3          Completed Instances Directory
A.6.1.1.X.2.Z.1.4          In Progress Invocations Directory
A.6.1.1.X.2.Z.1.5          Hub Data Repository
A.6.1.1.X.2.Z.2            Active Instances
A.6.1.1.X.2.Z.2.N          {Name} Instance Configuration Document  ← live record
A.6.1.1.X.2.Z.3            Completed Instances
A.6.1.1.X.2.Z.4            In Progress Invocations
```

**ICD directory positions vary** — ICDs can be under Active (`.Z.2.N`), Completed (`.Z.3.N`), or In-Progress (`.Z.4.N`). Never assume Active Instances is the only position. **Allocation System inserts a `Multi-Instance Coordinator Document` at `.Z.2`**, shifting Active Instances to `.Z.3` and Completed to `.Z.4` — one more reason to walk by title rather than by tier index.

**All extraction uses doc_no arithmetic, not parentId** (depth cap makes parentId unreliable for docs deeper than 6 segments).

**Primitive-root resolver (shared helper).** A previous convention (`ancestorByStripping(d, 2)`) landed 77 Allocation System edges on directory intermediaries like "Ethereum Mainnet Instances" because ICDs there sit several levels below the Primitive root. Use this instead:

```javascript
// Locates the real Primitive root for any per-agent ICD.
// Primitive roots always live at A.6.1.1.X.2.G.P — agent X, Sky Primitives
// section (.2), primitive group (.G), primitive (.P).
function primitiveRootFor(doc) {
  const m = doc.doc_no.match(/^(A\.6\.1\.1\.\d+\.2\.\d+\.\d+)(?:$|\.)/);
  if (!m) return null;
  const root = docByDocNo.get(m[1]);
  return root && /Primitive$/i.test(root.title) ? root : null;
}
```

`scripts/build-graph.mjs:226`. Must be used everywhere that previously called `ancestorByStripping(d, 2)` to reach a primitive root.

**Extraction rules:**

- `implements`: The primitive root always opens with `"... See [Global Name](uuid)."` — match the literal `"See [text](uuid)"` pattern where the target is under `A.2.2`. Only for `A.6.1.1.*` docs. Do not derive from `cites` edges (too broad).
- `instance_of`: ICD → primitive root via `primitiveRootFor(icd)`. Only for `A.6.1.1.*` ICDs — not global `A.2.2.*` docs whose titles mention "Instance Configuration Document". Edge meta carries `{status: "Active"|"Completed"|"Pending"}` for in-scope primitives (see Pattern 14).
- `located_at`: ICD Location doc always contains a UUID link to the actual ICD in its content. Extract UUID from content — do not guess from doc_no (directory position varies). **A handful of ICD Location docs in the atlas are misnamed** (title lacks the "Location" suffix, reading just "X Instance Configuration Document" instead of "X Instance Configuration Document Location"). Detect by content too, not title alone:
  ```javascript
  const isICDLocation = d =>
    /instance configuration document location/i.test(d.title) ||
    /^\s*This Instance['’]s associated Instance Configuration Document is located at/i.test(d.content ?? "");
  ```
  `scripts/build-graph.mjs:128`. Without the content fallback, misnamed Location docs get emitted as duplicate ICD entities that overwrite the real ones.
- `has_status`: Global Activation Status is at `{primRoot}.1.1`. Only for `A.6.1.1.*` docs.

### Pattern 3: Executor Agent role assignment (Prime → Executor)

Within an Executor Accord active instance:
```
A.6.1.1.X.2.Z.2.N.1.1.1    Operational/Core Executor Agent
```
This doc's content cites `A.6.1.2.Y` via a UUID link — authoritative link from Prime to Executor.

Emit a **role-specific** edge in the **executor → prime** direction (Atlas framing: "Ozone's work in supporting the Agents that it serves **as the Operational Executor Agent for**", A.2.8.2.9.2.1.2):

- `operational_executor_agent_for`: if the target executor is `agent/operational_executor`
- `core_executor_agent_for`: if the target executor is `agent/core_executor`

Sources: `[A.6.1.1.X.2.Z.2.N.1.1.1, A.2.8.2.N]` (ICD parameter doc + matching Ecosystem Accord).

Executors may serve multiple Primes — emit one edge per ICD parameter doc.

### Pattern 4: Ecosystem Accords

Every child of `A.2.8.2` is an active accord. Title format `"Ecosystem Accord N: {Party} And {Party}"` for bilateral; descriptive name for multi-party (e.g. `A.2.8.2.2 "Prime Program"` = Sky + Spark + Grove + Moonbow). Parse parties from the party-details docs — do not assume bilateral from title.

- `ecosystem_accord`: `doc(A.2.8.2.N) → entity(each_party)`, source: `[A.2.8.2.N]`. Target is the **composite_party** entity (e.g. "Spark"), not its members — members are surfaced via `comprises` (Pattern 12).

The "Sky" party always comprises "Sky Core" verbatim in all 8 accords.

### Pattern 5: Facilitator / GovOps assignment

**Operational Executor Agents** (full prefix):
- `"The Operational Facilitator for {Executor} is {Name}."`
- `"Operational GovOps for {Executor} is {Name}."`

**Core Council Executor Agents** (no prefix — make regex optional):
- `"The Facilitator for {Executor} is {Name}."`
- `"GovOps for {Executor} is {Name}."`

Emit one of four **role-specific** edges (entity → agent(executor)):

| Source doc | Edge |
|---|---|
| `A.6.1.2.Y.1` (Operational) | `operational_facilitator_for` |
| `A.6.1.2.Y.1` (Core) | `core_facilitator_for` |
| `A.6.1.2.Y.2` (Operational) | `operational_govops_for` |
| `A.6.1.2.Y.2` (Core) | `core_govops_for` |

Source: `[A.6.1.2.Y.1]` or `[A.6.1.2.Y.2]`. Entity gets `entity_type = facilitator_org` or `govops_org` respectively.

### Pattern 6: Active Data

Every `type = "Active Data Controller"` contains:
- `"The Responsible Party is {Entity Name}."` → `responsible_party_for` edge
- Active Data docs at `*.0.6.X`

- `responsible_party_for`: `entity → doc(controller)`, source: the controller doc
- `active_data_for`: `doc(*.0.6.X) → doc(controller)`, structural from doc_no suffix

### Pattern 7: ERG membership

Source: `A.1.8.1.2.2.0.6.1`. Members are plain-text list items with no UUID — create synthetic entities.

- `erg_member_for`: `entity(member) → doc(A.1.8.1.2.2.0.6.1)`, source: `[A.1.8.1.2.2.0.6.1]`

### Pattern 8: UUID citation links

Every `[text](uuid)` markdown link → `cites` edge, source: `[source_doc_no]`

### Pattern 9: Supporting doc suffixes

| Suffix | Type | Edge |
|---|---|---|
| `*.0.3.X` | Annotation | `annotates` → parent |
| `*.0.4.X` | Action Tenet | `annotates` → parent |
| `*.0.6.X` | Active Data | `active_data_for` → parent controller |
| `*.varX` | Scenario Variation | `annotates` → parent |

### Pattern 10: Aligned + Ranked Delegates

All delegates are "Aligned Delegates" relative to Sky Governance. A subset are "Ranked Delegates" with a budget level.

**Aligned Delegates list:** `A.1.5.1.5.0.6.1` (Active Data, referenced at atlas line 1935: "The list of currently recognized Aligned Delegates is defined as Active Data in [A.1.5.1.5.0.6.1 - Current Aligned Delegates](…)").

- `aligned_delegate_for`: `entity(delegate) → entity(Sky Governance)`, source: `[A.1.5.1.5.0.6.1]`

Each delegate entity has `entity_type = delegate_org`.

**Ranked Delegates** (subset with budget). Doc_no template is `A.1.5.4.1.{level}.3.1`:

| doc_no | Content (verified) |
|---|---|
| `A.1.5.4.1.1.3.1` | "The current Level 1 Ranked Delegates are BLUE and Cloaky." |
| `A.1.5.4.1.2.3.1` | "The current Level 2 Ranked Delegate is Bonapublica." |
| `A.1.5.4.1.3.3.1` | **Does not exist.** L3 has selection criteria (`A.1.5.4.1.3.3`) and one annotation (`A.1.5.4.1.3.3.0.3.1`) but no current-members enumeration. |

Content shape varies by count — L1 plural (`Delegates are X and Y`), L2 singular (`Delegate is X`). Regex must accept both:

```
/Ranked Delegates?\s+(?:are|is)\s+([^.]+)\./i
```

Split the name list on `,\s*|\s+and\s+`. For each name:

- Emit `ranked_delegate_for`: `entity → entity(Sky Governance)`, `meta.level = L`, source: `[A.1.5.4.1.L.3.1]`.

Ranked delegate status is layered on top of Aligned Delegate status — if the entity also has `aligned_delegate_for`, keep both edges. Do not subtype the entity; the ranking is purely an edge property.

### Pattern 11: Role bindings (`holds_role_for`)

Ad-hoc role assignments where a named entity holds a specific atlas-defined role. Currently one instance:

| doc_no | Role slug | Holder (content) |
|---|---|---|
| `A.1.7.1.1.2` | `core_council_risk_advisor` | "The Core Council Risk Advisor role is held by BA Labs." |

Extraction: match `/role is held by\s+([^.]+)\./i`. Ensure the holder exists in `entityMap` (create as `ecosystem_actor` if new). Emit:

- `holds_role_for`: `entity(holder) → doc(binding_doc)`, `meta.role = "<role_slug>"`, source: `[binding_doc_no]`

Destination is the binding doc because the atlas does not always give the role a distinct entity target. Add future role bindings as new rows in the table above; the extraction pattern is generic.

### Pattern 12: Composite accord parties

Source: `A.2.8.2.Y.1.1` ("Parties To The Accord"). Each party has a details subdoc at `A.2.8.2.Y.1.1.N` with content shaped like:

> `"The party 'NAME' comprises X, Y, and Z."`

**Both the composite and its members are entities.** Users directed: "we definitely want A [composite as entity] but we might also need B [members as entities] — both."

**Examples from the atlas:**
- `A.2.8.2.2.1.1.2` — "The party 'Spark' comprises the Spark Prime Agent, Spark Foundation, and Phoenix Labs."
- `A.2.8.2.2.1.1.3` — "The party 'Grove' comprises the Grove Prime Agent, and Grove Foundation."
- `A.2.8.2.3.1.1.2` — "The party 'Keel' comprises the Keel Prime Agent, Keel Foundation, and Elodin."
- `A.2.8.2.4.1.1.2` — "The party 'Obex' comprises the Obex Prime Agent, Rubicon, and Treadstone."
- `A.2.8.2.6.1.1.2` — "The party 'Launch Agent 6' comprises the Launch Agent 6 Prime Agent, Launch Agent 6 Foundation, and Stablewatch."
- `A.2.8.2.7.1.1.2` — "The party 'Skybase' comprises the Skybase Prime Agent, Skybase Foundation, and Development Company."
- `A.2.8.2.8.1.1.2` — "The party 'Amatsu' comprises the Amatsu Executor Agent." (single-member composite)
- `A.2.8.2.9.1.1.2` — "The party 'Ozone' comprises the Ozone Executor Agent." (single-member composite)
- `A.2.8.2.N.1.1.1` — always "The party 'Sky' comprises Sky Core."

**Atomic parties (no `comprises` phrase).** A handful of party-details docs describe parties that do not decompose further, using a different sentence shape:

> `"The party 'NAME' is <descriptor>."`

Known case: `A.2.8.2.2.1.1.4` — "The party 'Moonbow' is the entity owning relevant intellectual property." Moonbow has no members — it is a single atomic party within the Prime Program accord.

Extractor must match a fallback regex after the `comprises` regex fails:

```js
const COMPRISES_RE = /The party ['‘]([^'’]+)['’] comprises\s+(.+?)\./i;
const ATOMIC_PARTY_RE = /The party ['‘]([^'’]+)['’]\s+is\b/i;
```

Atomic parties are modelled as `composite_party` entities with **zero** `comprises` edges. This keeps the `ecosystem_accord` edge shape uniform (accord → composite_party) regardless of whether the party decomposes. See Editorial Decisions.

**Extraction:**
1. For each doc_no matching `A.2.8.2.\d+.1.1.\d+`, match `/The party ['‘]([^'’]+)['’] comprises\s+(.+?)\./i`. Handles both ASCII `'` and typographic `‘’` quotes.
2. Create/reuse a `composite_party` entity for the party name (e.g. `Spark`). Distinct slug from member entities (`spark` vs `spark-prime-agent`).
3. Parse the member list: split on `,\s*` then on `\s+and\s+`. Strip leading articles (`the\s+`).
4. Resolve each member to an existing entity first (Spark Prime Agent → via defining_doc_id from A.6.1.1.1; Sky Core → bootstrap). For unresolved members, type by shape:
   - Title ends in `"Foundation"` → `foundation`
   - Known dev-co pattern (Phoenix Labs, Elodin, Treadstone, Stablewatch, Rubicon, "Development Company") → `development_company`
   - Title ends in `"Executor Agent"` and matches an existing agent → reuse that agent entity
   - Otherwise → `ecosystem_actor`
5. Emit `comprises`: `composite_party → member entity`, source: `[A.2.8.2.Y.1.1.N]`, one edge per member.
6. The `ecosystem_accord` edge (Pattern 4) points to the **composite** entity, not individual members. Members are reached via `comprises`.

The single-member case (Ozone, Amatsu) is still modelled as a composite_party entity with one `comprises` edge — this keeps the edge shape uniform across accords and lets the UI render any party consistently.

### Pattern 13: Bootstrap entities (Sky Core / Sky Governance)

These atlas concepts are targets of role edges but have no single defining doc to key on. Bootstrap them by name with stable slugs:

| Slug | Name | entity_type | Target of |
|---|---|---|---|
| `sky-core` | Sky Core | `operational_party` | `prime_agent_for`, `ecosystem_accord`, `comprises` (inbound from "Sky" composite party) |
| `sky-governance` | Sky Governance | `governance_body` | `aligned_delegate_for`, `ranked_delegate_for` |

These are the only hardcoded entities. Everything else is pattern-derived from atlas docs. Bootstraps have no `defining_doc_id`.

**`sky-ecosystem` is intentionally not a bootstrap.** See Editorial Decisions for rationale.

**Sky Frontier Foundation** and **Sky Fortification Foundation** are NOT bootstraps — they have defining grant docs under `A.2.13.1` and surface through ordinary `foundation` extraction (grants recipients list + address labels).

### Pattern 14: Primitive Instance entities

Every ICD under an allowlisted primitive becomes an `et="instance"` entity. Entity id == ICD doc UUID, `st` = primitive slug, `did` = ICD UUID, meta carries `{primitive_doc_no, agent_doc_no, status, params}`.

**Scope allowlist** (`scripts/build-graph.mjs:526`). Add here when a new primitive should get instance entities:

```javascript
const INSTANCE_SCOPED_PRIMITIVES = {
  "Distribution Reward Primitive":      "distribution-reward",
  "Integration Boost Primitive":        "integration-boost",
  "Allocation System Primitive":        "allocation-system",
  "Pioneer Chain Primitive":            "pioneer-chain",
  "Core Governance Reward Primitive":   "core-governance-reward",
  "Agent Token Primitive":              "agent-token",
  "Executor Accord Primitive":          "executor-accord",
  "Root Edit Primitive":                "root-edit",
  "Distribution Requirement Primitive": "distribution-requirement",
  "Upkeep Rebate Primitive":            "upkeep-rebate",
};
```

**Excluded deliberately:** `Agent Creation Primitive`, `Prime Transformation Primitive`. Both are single-invocation lifecycle milestones whose outcome is already captured by the Prime Agent entity (created, transformed). Emitting instance entities for them would add 16 low-information boilerplate entities with no distinguishing params.

**Status derivation.** `{status}` lives on both the entity meta and the `instance_of` edge meta. Derive by **reading the tier doc's title**, not its position — Allocation System inserts a Multi-Instance Coordinator Document that shifts every tier down by one:

```javascript
function instanceStatusFor(icd, primRoot) {
  const rest = icd.doc_no.slice(primRoot.doc_no.length + 1);
  if (!rest) return null;
  const tierSeg = rest.split(".")[0];
  const tierDoc = docByDocNo.get(`${primRoot.doc_no}.${tierSeg}`);
  const title = tierDoc?.title.toLowerCase() ?? "";
  if (title === "active instances") return "Active";
  if (title === "completed instances") return "Completed";
  if (title === "in progress invocations") return "Pending";
  return null;
}
```

`scripts/build-graph.mjs:539`.

**Walk by title, not by doc_no position.** The ICD sub-structure is inconsistent across primitives:

| Primitive | ICD.1 | ICD.2 | Reward Code location |
|---|---|---|---|
| DR/IB/Agent Token (Active instance) | `Parameters` | `Operational Process Definition` | `ICD.1.1` |
| DR/IB (In-progress invocation) | `Invocation Status` | `Parameters` | `ICD.2.1` |
| Allocation System | `RRC Framework Full Implementation` | `Parameters` | deeper under `ICD.2.{subdir}.N` |

Walk children of the ICD until you find `title === "Parameters"`, then walk that subtree. Never assume `ICD.1 = Parameters`.

**Params extraction** (`scripts/build-graph.mjs:611`, `extractInstanceParams`). BFS from the Parameters doc; each leaf becomes a key/value pair in `meta.params`. Leaf = doc with no children, content not matching `DIRECTORY_RE = /^The documents? herein (define|contain|organize|govern|specify|describe|set|compose|hold)\b/i`. On title collision (e.g. Pioneer Chain has two `Network` leaves), disambiguate with `"{parentTitle} / {leafTitle}"`. The `Custom Instance Parameters` subtree is skipped at every level — it's a reserved extension slot that's empty in practice.

**Params shape: tuple `[value, srcUuid, srcDocNo]`.** Each param key maps to a 3-tuple, not a bare string:

```json
"params": {
  "Reward Code": ["128", "1e5d71a8-…", "A.6.1.1.1.2.5.1.2.1.1.1"],
  "Integration Partner Reward Address": ["0xac140648…", "5b5f88ff-…", "A.6.1.1.1.2.5.2.2.1.1.2"]
}
```

The source UUID is the leaf doc's id; `docs[uuid].content` is always the raw pre-formatted content. Consumers get display strings + navigation targets without re-walking the tree at render time.

**Per-key formatters** (`scripts/build-graph.mjs:582`, `PARAM_FORMATTERS`). Each well-known leaf title has a registered formatter that turns raw prose into the value slot. Unknown keys fall through to `unwrapBackticks + trim`. Current registry keys:

```
Reward Code / Integration Partner Name / Integration Partner Reward Address /
Integration Partner Chain / Integration Boost Cadence / Token Name /
Token Symbol / Genesis Supply / Token Address / Underlying Asset Address /
Allocator Role Address / Pool Address / Address / Network / Target Protocol /
Token / Asset Supplied By Spark Liquidity Layer
```

**Per-key expanders** (`scripts/build-graph.mjs`, `PARAM_EXPANDERS`). When a single leaf packs multiple values into prose, a registered expander returns `Array<[key, value]>` and each tuple becomes its own param entry (sharing the source doc). The expander runs before the formatter; returning `null` falls through to the regular formatter path. Currently one entry:

- `Token Address` (Agent Token only). Pattern:
  *"The address of SPK on the Ethereum Mainnet is `0x…`. The address of SPK on Base is `0x…`."*
  Expands to `Token Address (Ethereum Mainnet)` + `Token Address (Base)` tuples — one per chain clause. When the content doesn't match (e.g. Allocation System's single backtick-wrapped address, or unset Agent Token prose like *"The address of KEEL will be specified in a future iteration"*), the expander returns `null` and the regular formatter runs — preserving the single-`Token Address`-key behaviour for those consumers.

**Generic bullet-list expansion** (`scripts/build-graph.mjs`, `expandBulletList`). Runs AFTER per-title expanders as a fallback. Matches the atlas convention used for rate limits and similar parameter groupings:

```
The {variant} rate limits are:

- `maxAmount`: 200,000,000 USDS
- `slope`: 400,000,000 USDS per day
```

Any leaf whose content contains `- \`key\`: value` bullets is expanded into `{leafTitle} / {bulletKey}` sub-keys. Produces 343 rate-limit sub-keys today across 95 Allocation System instances (Inflow / Outflow / Deposit / Withdrawal / Swap rate limits, each with `maxAmount` / `slope` / `maxSlippage`). Consumers get direct field lookup instead of regex-parsing prose.

Regex: `/^\s*[-*]\s+\`([^\`\n]+)\`\s*:\s*(.+?)\s*$/gm`. Single-bullet leaves still expand — the backtick-key + colon shape is distinctive enough that false positives haven't appeared in the atlas today. If a future doc uses casual backtick-bullet prose that shouldn't be expanded, add an intro-anchor gate (e.g. require `/\bare\s*:\s*\n/` preceding the bullets).

**Known key variations** — the atlas doesn't always use the same title for structurally similar params. Record normalisation is a consumer problem, not an extractor one:

- `Token Address` vs `Token Address (ERC4626 Vault)` — Allocation System ICDs suffix vault type
- `Token Address` vs `Pool Address` vs `Underlying Asset Address` — Allocation System uses whichever matches the protocol shape
- `Token Address` vs `Token Address (<Chain>)` — Agent Token's per-chain expansion. Agents with deployed tokens get one chain-qualified key per chain; agents whose token is unannounced still emit a single `Token Address` key carrying the placeholder prose.

### Pattern 15: `invoked_by` — instance → agent affiliation

Every in-scope Instance entity emits an entity→entity `invoked_by` edge to its Prime Agent. Purpose: the `/constellations` graph clusters Instances under their owning agent instead of leaving them as 170+ floating nodes.

- `invoked_by`: `entity(instance) → entity(agent/prime)`, source: `[ICD doc_no]`, meta mirrors the `instance_of` status payload
- Resolver: match the ICD doc_no against `/^(A\.6\.1\.1\.\d+)/` to locate the prime agent doc, then its entity via `entityByDocId`
- `scripts/build-graph.mjs:747`

---

## Editorial Decisions

The extractor is not a neutral reading of the atlas — it makes judgment calls where the atlas underdetermines the graph shape, where literal extraction would over-fragment the model, or where downstream consumers (UI, MCP, reports) benefit from a uniform shape. Each choice is listed here so others can scrutinize (and contest) it.

### 1. `Sky Ecosystem → Sky Core` merge for `prime_agent_for`

**Atlas phrasing:** Prime Agents "serve as Prime Agent for the Sky Ecosystem" (A.6, A.6.1.1). Sky Ecosystem is a **Scope** (a markdown region that regulates Agents), not an acting party.

**Choice:** We do not emit a `sky-ecosystem` entity. `prime_agent_for` edges target `sky-core` instead.

**Why:**
- Sky Ecosystem has no legal, operational, or governance identity of its own — every concrete action attributed to "Sky" in accords is performed by Sky Core ("The party 'Sky' comprises Sky Core" in all 8 accords).
- Emitting a separate `sky-ecosystem` entity created a second dangling hub in the entity subgraph with exactly one inbound edge kind, no outbound edges, and no usable defining doc.
- Downstream consumers always want the same answer to "who represents Sky here?" — this keeps that answer stable across `prime_agent_for`, `ecosystem_accord`, and `comprises`.

**What we lose:** the Scope-vs-party distinction is flattened in the graph. If a future consumer needs to reason about the Scope (regulatory framing) separately from the operational party, they will need to key on doc `A.6` directly rather than on an entity.

### 2. Sky party short-circuit in `comprises`

**Atlas phrasing:** every accord contains `A.2.8.2.N.1.1.1` — "The party 'Sky' comprises Sky Core."

**Choice:** The "Sky" composite party is not re-created per accord. The `ecosystem_accord` edge for the Sky side of every accord points directly to the shared `sky-core` entity, skipping a per-accord "Sky" composite.

**Why:** Sky's composite expansion is identical across all 8 accords and carries no per-accord information. Creating 8 identical `comprises` edges from 8 "Sky" composites to the same `sky-core` would inflate the edge set without adding signal.

**What we lose:** query shape asymmetry. For every other party you traverse `accord → composite_party → comprises → member`; for Sky you traverse `accord → sky-core` directly. Consumers must be aware of this.

### 3. Atomic parties modelled as `composite_party` with zero members

**Atlas phrasing:** `A.2.8.2.2.1.1.4` — "The party 'Moonbow' is the entity owning relevant intellectual property." No `comprises` phrase.

**Choice:** Moonbow is a `composite_party` entity with **zero** `comprises` edges, same entity_type as decomposing parties.

**Why:** we want a uniform `ecosystem_accord → party` edge shape. Introducing a distinct `atomic_party` entity_type would force every consumer to branch on party kind. A composite with zero members is a cheap unification.

**What we lose:** the `composite_party` name is slightly inaccurate for atomic parties — "accord_party" would read better. Left as-is to avoid churn.

### 4. Single-member parties modelled as `composite_party`

**Atlas phrasing:** `A.2.8.2.8.1.1.2` — "The party 'Amatsu' comprises the Amatsu Executor Agent." (one member).

**Choice:** Same shape as multi-member parties — `composite_party` entity with one `comprises` edge.

**Why:** uniformity across accords. The UI can render every party identically; no special casing for single-member parties.

### 5. `ecosystem_actor` as a catch-all

**Choice:** When a named actor surfaces through a pattern (ERG member, role binding, composite member with no other signal) and doesn't match any more specific entity_type, it gets `ecosystem_actor`.

**Why:** the alternative — refusing to extract or inventing ad-hoc types — either loses the relationship or fragments the taxonomy. `ecosystem_actor` is explicit about the uncertainty and lets downstream consumers group or ignore these uniformly.

**What we lose:** the type carries no semantic content. It functions as "there is a named thing here, but we don't know what it is."

**Filter:** `relations.json` (the lean browser artifact) drops all `ecosystem_actor` entities and any edges incident to them. They remain in the full `graph.json`. Most `ecosystem_actor`s have only one or two edges and produce visual clutter without advancing the Agent/Accord story.

### 6. `delegate_org` naming for individuals

**Atlas phrasing:** delegates like "BLUE", "Cloaky", "Bonapublica" are named as teams/brands/individuals — not organizations in the formal sense.

**Choice:** All delegates get `entity_type = delegate_org`, including single-person delegates.

**Why:** they act as delegates in exactly the same way regardless of legal form. A `delegate` vs `delegate_org` split would be noise — consumers care that it's a delegate, not that it's incorporated.

### 7. Dual output: `graph.json` vs `relations.json`

**Choice:** we emit two artifacts — a full `graph.json` with every entity and edge, and a lean `relations.json` that:
- drops `ecosystem_actor` entities and their edges
- drops all `parent_of` edges (structural hierarchy is recoverable from `doc_no`)
- drops entity-free doc→doc edges not needed by the entity UI

**Why:** the browser's entity-flow canvas becomes unreadable above ~150 nodes. The MCP needs the full set for graph queries.

**What we lose:** two contracts to maintain. Tests (`tests/graph.test.ts`) assert invariants on both shapes.

### 8. Edge `weight = 1.0` is a placeholder

**Current state:** every edge has `weight: 1.0`. No heuristic, no propagation, no calibration.

**Future:** edge weights may eventually reflect something like "strength of institutional coupling" — but this is deferred until we have a concrete consumer and a principled scoring rule. Treating weight as meaningful today would be false precision.

### 9. Instance-as-entity scope is an allowlist, not every ICD

**Atlas phrasing:** every Primitive can be invoked, and every invocation produces an ICD (A.2.2.1.3). A uniform reading would emit an `et="instance"` entity for every ICD the atlas contains.

**Choice:** only the 10 primitives in `INSTANCE_SCOPED_PRIMITIVES` get instance entities. `Agent Creation Primitive` and `Prime Transformation Primitive` are intentionally excluded.

**Why:** both excluded primitives are single-invocation lifecycle milestones. The outcome of "Agent X invoked Agent Creation" is already modelled by the existence of the Prime Agent entity itself. Emitting 16 boilerplate "Single" instances (8 agents × 2 primitives) with empty params would add noise without signal. The allowlist also bounds entity count — adding all ICDs would roughly double the entity count for primitives that have nothing meaningful to expose.

**What we lose:** two minor gaps in the structural model. If a future consumer needs to cite "Spark invoked Agent Creation Primitive at doc A.6.1.1.1.2.1.1.3.1", they walk the atlas directly — there is no entity to query.

### 10. Instance params are `[value, srcUuid, srcDocNo]` tuples with per-key formatters

**Atlas phrasing:** ICD Parameters children encode structured configuration (`Reward Code: 128`, `Integration Partner Chain: Ethereum Mainnet`, `Token Address: 0x…`) as prose — usually one-sentence leaves like *"The partner for the Aave Integration Boost is Aave."*

**Choice:** at build time, every Parameters leaf becomes a 3-tuple on the Instance entity's `meta.params`: `[formattedValue, srcDocUuid, srcDocNo]`. A per-key formatter registry (`PARAM_FORMATTERS`) strips the prose so the value slot is the clean datum ("Aave", "Ethereum Mainnet", "0x…"). Unknown keys fall through to a backtick-unwrap + trim fallback.

**Why:**
- Consumers get display strings without re-implementing prose-stripping at render time
- Source UUID + doc_no always accompany the value, so the raw content is one navigation away (`docs[uuid].content`) if a consumer wants it
- Formatters live in one place — adding a new key means one registry entry, not per-consumer duplication
- Builds the foundation for future MCP queries: "what's the Reward Code for Spark's SparkLend instance?" is a direct lookup, no regex

**What we lose:** the value slot is destructive — the formatter has a single authoritative output. Compound prose like Agent Token's Token Address (multi-chain addresses in one blob) gets the first address only; accessing the rest requires walking the source content. Key variations (`Token Address` vs `Pool Address` vs `Token Address (ERC4626 Vault)`) are preserved as-written; consumer-side normalization is on the consumer.

### 11. Walk by title, not by doc_no position within an ICD

**Atlas phrasing:** ICD sub-structure is *not* uniform. Active instances start with `.1 = Parameters`. In-progress invocations interpose `.1 = Invocation Status`, shifting Parameters to `.2`. Allocation System starts with `.1 = RRC Framework Full Implementation`, with Parameters at `.2` and deeper nesting (`Parameters → Instance Identifiers → Network`).

**Choice:** every ICD-descent traversal in the extractor (`extractInstanceParams`, `instanceStatusFor`, and consumer helpers like `rewardsIndex.findParamDoc`) walks by matching titles ("Parameters", "Active Instances", "Reward Code") rather than by tier index.

**Why:** tier indexing silently breaks when the atlas introduces a new sibling doc at `.1` or renumbers. The extractor from v1.5 assumed `{ICD}.1.1 = Reward Code` for DR — which was correct for active instances but missed every in-progress invocation's Reward Code because its path is `{ICD}.2.1`. Title-match is structurally stable.

**What we lose:** a handful of ms per ICD for the title match. In exchange, resilience to atlas restructures.

---

## Global Primitive Categories (A.2.2)

Derive category from the `implements` citation target's parent section:

| doc_no | Category |
|---|---|
| `A.2.2.4` | Genesis |
| `A.2.2.5` | Operational |
| `A.2.2.6` | Ecosystem Upkeep |
| `A.2.2.7` | SkyLink |
| `A.2.2.8` | Demand Side Stablecoin |
| `A.2.2.9` | Supply Side Stablecoin |
| `A.2.2.10` | Core Governance |

---

## Edge Type Vocabulary

**Role edges** (entity → entity):

```
prime_agent_for                    entity  → entity   agent(prime)       → Sky Core  (see Editorial Decisions)
operational_executor_agent_for     entity  → entity   agent(op-exec)     → agent(prime)
core_executor_agent_for            entity  → entity   agent(core-exec)   → agent(prime)
operational_facilitator_for        entity  → entity   facilitator_org    → agent(executor)
core_facilitator_for               entity  → entity   facilitator_org    → agent(executor)
operational_govops_for             entity  → entity   govops_org         → agent(executor)
core_govops_for                    entity  → entity   govops_org         → agent(executor)
aligned_delegate_for               entity  → entity   delegate_org       → Sky Governance
ranked_delegate_for                entity  → entity   delegate_org       → Sky Governance; meta.level
```

**Composition / membership / affiliation**:

```
comprises                          entity  → entity   composite_party → member entity
erg_member_for                     entity  → doc      ERG member → A.1.8.1.2.2.0.6.1
responsible_party_for              entity  → doc      Responsible Party → Active Data Controller
holds_role_for                     entity  → doc      Named role binding; meta.role
invoked_by                         entity  → entity   instance → agent(prime); meta.status
```

**Accord / definition**:

```
ecosystem_accord                   doc     → entity   Ecosystem Accord doc → each party (composite_party)
defines_entity                     doc     → entity   Defining doc → the entity it names
```

**Addresses**:

```
has_address                        entity  → address  Entity owns an on-chain address (1:N supported)
controlled_by                      address → entity   Address controlled by entity
proxies_to                         address → address  Proxy → implementation address
mentions                           doc     → address  addressRefs in doc content
```

**Structural (doc → doc)**:

```
parent_of                          doc     → doc      Structural hierarchy (from parentId, reliable for depth ≤ 6)
cites                              doc     → doc      UUID markdown link [text](uuid) in content
annotates                          doc     → doc      Annotation/Tenet/Variation (*.0.3.X, *.0.4.X, *.varX)
active_data_for                    doc     → doc      Active Data (*.0.6.X) → its controller
located_at                         doc     → doc      ICD Location → ICD (via UUID in content)
instance_of                        doc     → doc      ICD → primitive root (strip 2 segments)
has_status                         doc     → doc      Primitive root → Global Activation Status (strip 2)
implements                         doc     → doc      Agent primitive → global def in A.2.2 (via "See" cite)
```

**Total: 26 edge types.**

### Entity meta serialization

Participants ship with an optional `m: string` field in `relations.json` carrying JSON-serialised meta (see `Participant` in `src/types.ts`). Previously meta was dropped at serialisation; the `m` field is now forwarded to browser consumers. Reader shape:

```typescript
interface Participant {
  id: string; slug: string; name: string;
  et: string; st: string | null; did: string | null;
  m?: string;  // JSON-stringified meta; present for et="instance"
}
```

For `et="instance"`, the parsed meta is:

```typescript
{
  primitive_doc_no: string;   // e.g. "A.6.1.1.1.2.5.1"
  agent_doc_no: string;       // e.g. "A.6.1.1.1"
  status: "Active" | "Completed" | "Pending" | null;
  params: Record<string, [value: string, srcUuid: string, srcDocNo: string]>;
}
```

**v1.3 diff from v1.2:**
- **Added (role edges):** `prime_agent_for`, `operational_executor_agent_for`, `core_executor_agent_for`, `operational_facilitator_for`, `core_facilitator_for`, `operational_govops_for`, `core_govops_for`, `aligned_delegate_for`, `ranked_delegate_for`
- **Added (other):** `comprises`
- **Renamed:** `member_of_erg` → `erg_member_for`; `responsible_for` → `responsible_party_for`; `holds_role` → `holds_role_for`
- **Removed (replaced by role edges):** `member_of` (flat Facilitator/GovOps edge), `executor_accord` (flat Prime→Executor edge)

**v1.4 diff from v1.3:**
- **Editorial Decisions section added** — surfaces the 8 judgment calls baked into the extractor (Sky Ecosystem → Sky Core merge; Sky party short-circuit; atomic parties as composite_party; single-member parties; ecosystem_actor catch-all; delegate_org naming; dual output shape; edge weight placeholder).
- **Sky Ecosystem → Sky Core merge:** `prime_agent_for` now targets `sky-core`; `sky-ecosystem` entity and `ecosystem` entity_type removed from the schema.
- **Pattern 12 — Atomic parties:** documents the `ATOMIC_PARTY_RE` fallback for party-details docs that use "The party 'X' is ..." phrasing (e.g., Moonbow at `A.2.8.2.2.1.1.4`). Atomic parties are `composite_party` entities with zero `comprises` edges.
- **Pattern 13 — Bootstrap table:** `sky-ecosystem` row removed; only `sky-core` and `sky-governance` remain.
- **Output shape note:** dual `graph.json` / `relations.json` contract formalized in Editorial Decision §7. Test invariants in `tests/graph.test.ts`.

**v1.6 diff from v1.5:**
- **Entity Types table:** `instance` added. Entity id = ICD doc UUID; `st` = primitive slug from `INSTANCE_SCOPED_PRIMITIVES` (10 primitives).
- **Pattern 2 — primitive root resolver:** `primitiveRootFor(doc)` via `A.6.1.1.X.2.G.P` regex replaces the previous `ancestorByStripping(d, 2)` convention. The old heuristic landed 77 Allocation System edges on directory intermediaries (e.g. "Ethereum Mainnet Instances").
- **Pattern 2 — ICD Location content fallback:** `isICDLocation` now also matches by content (`This Instance's associated Instance Configuration Document is located at …`) so misnamed Location docs don't pollute the ICD entity set.
- **Pattern 14 (new) — Primitive Instance entities:** documents the scope allowlist, status-from-tier-title derivation, walk-by-title rule, `extractInstanceParams` traversal, the `[value, srcUuid, srcDocNo]` tuple shape, and the `PARAM_FORMATTERS` registry.
- **Pattern 15 (new) — `invoked_by` edge:** entity→entity edge from each Instance to its Prime Agent; mirrors `instance_of` status meta.
- **`instance_of` edge meta:** now carries `{status: "Active"|"Completed"|"Pending"}` for in-scope primitives.
- **`Participant.m`:** meta field is now shipped in `relations.json` (previously dropped); the `m` reader shape is documented in Entity meta serialization.
- **Editorial Decisions added:**
  - §9 Instance-as-entity scope is an allowlist (excludes Agent Creation + Prime Transformation)
  - §10 Instance params are `[value, srcUuid, srcDocNo]` tuples with per-key formatters
  - §11 Walk by title, not by doc_no position within an ICD
- **Edge total:** 25 → 26 (`invoked_by`).
- **Vocabulary tests:** `KNOWN_ENTITY_TYPES` gained `instance`; `KNOWN_EDGE_TYPES` gained `invoked_by` (`tests/graph.test.ts`).
- **`PARAM_EXPANDERS` added:** Agent Token's `Token Address` compound prose is now split into per-chain keys (`Token Address (Ethereum Mainnet)`, `Token Address (Base)`, …). Unset agents keep the single `Token Address` key with placeholder prose. Backward-incompatible for any consumer that expected a plain `Token Address` on Spark or Grove.
- **Generic bullet-list expansion:** any leaf whose content contains `` - `key`: value `` bullets splits into `{leafTitle} / {bulletKey}` sub-keys. Primary use: Allocation System rate limits — 343 new sub-keys across 95 instances, replacing opaque "Inflow Rate Limits" prose values with direct `{Inflow,Outflow,Deposit,Withdrawal,Swap} Rate Limits / {maxAmount,slope,maxSlippage}` lookups. Fires after per-title `PARAM_EXPANDERS`.

---

## Out of Scope (Atlas-excluded)

Categories the atlas itself excludes or frames as non-entities. Do not extract.

- **Shadow Delegates** (`A.1.9.2.2.4.2`): atlas says verbatim "They are not officially recorded in the Atlas and do not receive any compensation from Sky." Do not create entities for them.
- **Core Council** (`A.0.1.1.46`): defined as a *group of Executor Agents*, not a distinct actor. Already covered as the set of `agent/core_executor` entities whose titles start "Core Council Executor Agent". No separate entity kind.
- **SPK Company Ltd** (`A.6.1.1.1.2.1.4.2.1.2.1`): named legal entity with no atlas-level category. Extract as `ecosystem_actor` if a pattern surfaces it.

---

## Open Questions

- **Halo Agents**: mentioned in `A.6.1.1.5.1` as a future category — no structural pattern yet; do not classify
- **Proto-Agents**: atlas defines the stage but names no current instances. `agent/proto` subtype reserved; pattern will land if/when named
- **Multi-party Ecosystem Accords**: `A.2.8.2.2` (Prime Program) covers Sky + Spark + Grove + Moonbow — parse from party-details docs, not title
- **Executor Accord position**: currently `.2.2` for all checked agents — derive from citation, not position
- **Spell Roster roles** (Crafter, Reviewer, `A.1.9.2.1.9`): not verified; defer until we decide to extract spell-level roles
- **Grant events**: per-grant disbursements (e.g., `A.2.13.1.1.1` — August 2025 grant to SFF) are per-event data, not roles. Currently unextracted; revisit when time-series events become part of the model
- ~~**Compound prose values**~~ — **addressed**: `PARAM_EXPANDERS["Token Address"]` splits multi-chain prose into per-chain `Token Address (<Chain>)` keys for Agent Token. Unset agents (Keel, Skybase, Obex, Pattern, Launch Agent 6/7) still emit a single `Token Address` key with the placeholder prose. Future compound-prose patterns in other primitives can be handled by adding more expanders.
- **Key-variation normalisation**: `Token Address` vs `Pool Address` vs `Token Address (ERC4626 Vault)` are preserved as-written. A consumer-side normaliser (e.g. "any `*Address` key is an on-chain contract") has not been specified. Document the taxonomy once use cases converge
- **Integrator partners as entities**: Aave, Kamino, CoW Swap, Morpho vault operators etc. appear as Instance param values but have no entity identity. Promoting them would unlock per-partner cross-agent queries but requires defining the scope (all IB partners? Allocation System protocols too?) and a shape (`entity_type = "integrator"`?)
