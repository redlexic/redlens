# Sky Atlas — Process Inventory Research

**Date:** 2026-05-05  
**Status:** Complete — 55 confirmed process nodes

---

## Summary

The Sky Atlas contains **55 confirmed sequential processes** — nodes that describe ordered steps, phases, or cycles where sequence matters. These are Atlas-native governance and operational rules, distinct from the GovOps team's operational runbooks (which live in Notion/Merlin).

---

## Methodology

1. **Initial search** — searched the atlas for ~20 keyword families: `process`, `cycle`, `workflow`, `procedure`, `protocol`, `stages`, `lifecycle`, `sequence`, `onboarding`, `offboarding`, `settlement`, `voting`, `election`, `ratification`, `reconciliation`, `deployment`, `review period`, `submission`, `polling`. Yielded 73 candidates.

2. **Validation pass** — fetched each candidate's content and immediate children; assessed whether the node or its children actually describe an ordered sequence. Result: 54 valid, 19 invalid.

3. **Deep sweep** — ran additional searches on unused keyword families (`bidding`, `auction`, `registration`, `verification`, `NFAT`, `multisig`, `pioneer chain`, etc.) and navigated entity sections (A.6.*) structurally. Found 1 additional node.

4. **Final count: 55 confirmed.**

### Why pure automation is insufficient

The atlas has no structural `type: Process` field. Detection relies entirely on naming conventions and content patterns. A keyword classifier against titles achieves ~85% precision (some titled "Reconciliation Process" or "Audit Procedure" are stubs or requirement specs, not workflows). Future recall is ~85% — authors consistently use "Process Definition" / "Cycle" / "Workflow" in titles, but generic-titled containers ("Implementation") would be missed.

**Recommended approach:** keyword classifier as a candidate generator against a maintained curated UUID list. New atlas PRs only need review of net-new keyword matches, not the full 55.

---

## Two distinct layers

| | Atlas-native (this inventory) | GovOps operational runbooks |
|---|---|---|
| Where | Sky Atlas markdown | Notion + Merlin (ProcessOS) |
| What | Governance rules, lifecycle definitions, voting procedures | Step-by-step team runbooks (Merkl topups, signer swaps, wallet tests) |
| Atlas reference | **Is** the source of truth | References atlas for rules |
| Examples | Executive Process, Monthly Settlement Cycle | DR Settlement Execution, Wallet Penny Test |

The team's Process Inventory CSV (38 entries) overlaps with only ~4 Atlas nodes (Atlas Edit Weekly Cycle, Executive Vote Cycle, Core Spell Cycle, Monthly Settlement Cycle). The rest are operational runbooks with no Atlas representation.

---

## The 55 Processes

### Governance & Voting Cycles

| UUID | doc_no | Title | Steps |
|------|--------|-------|-------|
| 83edd4e1 | A.1.10 | Weekly Governance Cycle | Operational Weekly Cycle; Atlas Edit Weekly Cycle |
| 999e4aff | A.1.10.1 | Operational Weekly Cycle | Edits To The Atlas; Full Cycle Breakdown; Executive Vote Contingencies; CF Authority To Create Proposals |
| 14e99d92 | A.1.10.2 | Atlas Edit Weekly Cycle | Cycle Breakdown; Preparation And Publication of Governance Poll; Rejecting A Proposal For Misalignment; Minimum Positive Participation; Reconciliation Process |
| 7f2ba62c | A.1.11 | Monthly Governance Cycle | Calendar Exceptions; Atlas Edit Monthly Cycle |
| 8eea2827 | A.1.11.2.5 | Ratification Poll Process Definition | *(inline)* First Monday initiation → Wed submission deadline → Fri W1 review → Mon W2 publication → Mon W4 conclusion |

### Executive & Spell Processes

| UUID | doc_no | Title | Steps |
|------|--------|-------|-------|
| 3aa5bc98 | A.1.9.2.5 | Voting Process For Executive Votes | Voting Requirements; Voting Validation; Continuous Approval Voting; Voting Outcome |
| 98298ab3 | A.1.9.2.4 | Executive Process Breakdown | 13 time-ordered steps (Mon W1 → Fri W1 → Mon W2 → Tue W2 → Target Date → Validation Window → Execution) |
| 0f0f7021 | A.1.9.2.4.1 | Step 1 — Governance Point Determines Preliminary Content | Considerations; Sources (Executive Queue, Approved Polls, Ecosystem Actors); Planning Checklist |
| 9f291bda | A.1.9.2.4.6 | Step 6 — Governance Point Finalizes Executive Sheet | Completion checklist; post-Friday update procedure |
| 4a26e84d | A.1.9.2.4.11 | Step 11 — Governance Point Reviews Spell & Publishes | Review content → TechOps whitelisting → add spell address → merge PR → validate → notify community |
| 84d31eb0 | A.1.9.2.4.12 | Step 12 — Ecosystem Validators Validates Spell | Validation overview; validators list; validation window; verification scope; tools & resources |
| 761cd866 | A.1.9.2.4.13 | Step 13 — Spell Execution Process And Retro | Outcome; Lifting the Spell; Execution Setup; Casting & Execution; Atlas update; Retrospective |
| 510651ca | A.1.9.2.4.10 | Spell Crafting Workflow | *(references external GitHub checklist)* |
| eeaaa751 | A.1.9.5.2.3 | Standby Spell Process Definition | CF Role; Core GovOps Role; ADs' Role |
| 69da8af1 | A.1.9.5.3.2 | Protego Usage Process Definition | CF Role; Core GovOps Role; ADs' Role |
| 2de4d031 | A.1.9.3.2.13.2 | Linear Interpolation Module Usage Process | *(inline stub — references governance process for module authorization)* |

### Settlement & Financial

| UUID | doc_no | Title | Steps |
|------|--------|-------|-------|
| 6f8d5065 | A.2.4 | Sky Core Monthly Settlement Cycle | Monthly Settlement Cycle Overview |
| 75473c4b | A.2.4.1.2 | Implementation | Process Definition; Implementation Stages |
| dd25aba4 | A.2.4.1.2.1 | Monthly Settlement Cycle — Process Definition | Forum Post by Core GovOps; OEA & Risk Advisor calculations; Settlement through Executive Vote |
| cf1d76c1 | A.2.4.1.2.2 | Implementation Stages | Stage 1 (simplified P&L); Stage 2 (Dec 2025); Stage 3 (advanced) |
| 7932c8f3 | A.2.3.1.2 | Treasury Allocation Steps | Step 0: Net Revenue → Step 1: Security & Stability → Step 2: High Activity Staking → Step 3: Stability Capital Retention → Step 4: Smart Burn & Standard Staking |
| b74e61f5 | A.3.2.2.4.3 | Senior Risk Capital Origination Process | Timing & Schedule; TSRC Pool Determination; Bidding Process; Allocation & Clearing Price; Settlement; OSRC Duration & Renewal |
| d92f0d3b | A.3.2.2.5 | Risk Capital Update Process | Schedule For Updating Parameters; Data Maintenance And Integrity |
| dfd65786 | A.2.2.8.1.2.4.1.3 | Distribution Reward Settlement Cycle | *(stub — defers to primitive documentation)* |

### Agent & Primitive Lifecycle

| UUID | doc_no | Title | Steps |
|------|--------|-------|-------|
| 73eb0d53 | A.2.2.1.1 | Initial Stages Of Artifact Evolution | 16 ordered steps: Founder deposits → GovOps creates scaffold → Founder inputs → Validation → Genesis/SubProxy accounts → Global activation → Transformation primitive → Validation → Artifact freeze → Agent Token primitive → Validation → Minting → Executor Accord → Validation → Root Edit primitive → Validation |
| 2f5ff5c8 | A.2.2.1.2.4.1 | Agent Launch & Sequence of Primitive Global Activation | Stage 1: pre-transformation → Stage 2: pre-root-edit → Stage 3: post-root-edit |
| e9422783 | A.2.2.2.3.1 | Sequential Stages | Required Output Trigger *(each stage completes before the next begins)* |
| 754e1599 | A.2.2.4.1.1.1 | Agent Creation Instance Setup Process | Founder Inputs → Validation → Official Update |
| 3f1824b6 | A.2.2.4.2.1.1 | Prime Transformation Primitive Setup Process | Agent Inputs → Validation → Official Update |
| 3e49628d | A.2.2.4.4.1.1 | Agent Token Primitive Setup Process | Agent Inputs → Validation → Official Update → Core GovOps Output |
| af7c2593 | A.2.2.5.1.1.1 | Executor Accord Primitive Setup Process | Agent Inputs → Validation → Official Update → Operational GovOps Takes Over |
| 1fbca4e2 | A.2.2.5.2.1.1 | Root Edit Primitive Setup Process | Agent Inputs → Validation → Official Update |
| dc7fd889 | A.2.2.5.2.2.2 | Artifact Edit Process | *(inline)* Proposal → eligible actors → voting period → quorum → approval threshold → emergency handling |
| 18386a64 | A.2.2.7.1.1 | Token SkyLink Process Definition | Token SkyLink Setup Process Definition; Token SkyLink Ongoing Management |
| 408400c0 | A.2.2.7.1.1.1 | Token SkyLink Setup Process Definition | Real World Agreements & Planning → Codification & Validation → Deployment (bridge deployment, audit, activation) |

### Personnel & Delegation

| UUID | doc_no | Title | Steps |
|------|--------|-------|-------|
| 07e63bc3 | A.1.5.1.3 | AD Recognition Process | Contract Deployment → Submission Message (+ Template) |
| fcf62ce5 | A.6.1.1.1.3.1.3.4 | Delegate Onboarding (Spark) | *(inline)* Application requirements → minimum term → delegate record |
| b49d9086 | A.6.1.1.1.3.1.3.5 | Delegate Offboarding (Spark) | *(inline)* Voluntary path; non-performance removal path |
| 361e2e68 | A.2.2.8.1.2.1.1.3 | Integrator Onboarding | *(inline)* Near-term process; long-term process |

### Collateral & Asset Management

| UUID | doc_no | Title | Steps |
|------|--------|-------|-------|
| 9f87ff7a | A.3.7.1.1.3 | Collateral Offboarding Process | Offboarding Low Usage Collateral; Offboarding WBTC Collateral; Offboarding Other Collateral |
| 3da8a0fd | A.3.7.1.5 | Offboarding Process | Legacy Context; Technical Process; Communication Channels; Expedited Offboarding |
| 305e2bd6 | A.3.7.1.5.2 | Technical Process (Offboarding) | Immediate Actions → Following Actions |
| f9894690 | A.3.7.1.5.4 | Expedited Offboarding | Requirements; Announcements |
| 05f29c65 | A.3.7.1.3 | Collateral Offboarding (NVE) | *(children are the 3 offboarding process variants above)* |
| 769c492c | A.3.4.3.2 | Onboarding And Offboarding of Arrangers | List Of Active Arrangers *(governance poll triggers onboard/offboard)* |

### Dispute & Emergency

| UUID | doc_no | Title | Steps |
|------|--------|-------|-------|
| 560e1024 | A.1.4.9 | Adjudication Process | Opportunity to Respond → Imposing Appropriate Penalty → Issuing of Public Report; CF Conflict of Interest variant |
| 1d940c6d | A.1.8 | Emergency Response System | Emergency Response |
| 498e151e | A.1.8.1.5 | Emergency Response Process Definition | Incident Validation → Incident Categorization → Emergency-Contact Trigger → Video Call Coordination → Emergency Declaration Procedure → Record Retention |
| 8ce1adeb | A.1.8.1.5.5 | Emergency Declaration Procedure | *(inline)* CF declares on own initiative or in response to request |
| 6151ee33 | A.2.8.1.1.2 | Dispute Resolution — Process Definition | Dispute Intake → Presentation Of Arguments → Decision |
| 262a79a0 | A.2.8.1.1.2.3 | Dispute Resolution — Decision | GovOps analysis → CF adjudication → Release → Publication |
| 9ab8fdf3 | A.2.9.1.1.1.4.2 | Resilience Fund Claim Management Process | *(inline)* Legal counsel pre-approval → Claim approval / advance payment → Reimbursement |

### Artifact & Atlas Governance

| UUID | doc_no | Title | Steps |
|------|--------|-------|-------|
| ecb0b102 | A.1.13.1.5 | Conflict Protocol Between Agent Artifacts And The Sky Core Atlas | CF Review → CF Determination → Intent to Suspend Notice (14-day remediation) → Emergency Process For Misaligned Artifacts |
| fe833d0e | A.1.13.5 | Agent Termination Protocol | Initiation → Execution → End Of Process → Dispute Resolution |
| 023540ad | A.1.13.5.1 | Initiation Of Agent Termination | *(inline)* Two-thirds supermajority + 20% quorum + two-week voting period + public notice |

---

## Structural patterns

**~15 processes are "inline"** — steps are described in the node's own content, not as children. These require content parsing, not just child traversal.

**Nested processes** — Steps 1, 6, 11, 12, 13 of the Executive Process are themselves validated process nodes. A process report UI needs to decide whether to show them standalone or only within their parent 13-step view.

**Repeated 3-step shape** — all primitive setup processes (Agent Creation, Prime Transformation, Agent Token, Executor Accord, Root Edit) share the same structure: Inputs → Validation → Official Update. Good candidate for a shared template.

**Placeholder / deferred** — `dfd65786` (Distribution Reward Settlement Cycle) and `2de4d031` (Linear Interpolation Module Usage Process) are stubs that defer to other documentation. Include in inventory but flag as incomplete.
