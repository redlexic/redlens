// One-off: apply manually-audited stepCount values to public/processes.json.
// Scope: only entries where the runtime heuristic is unreliable (null fall-
// through, bullet-source, deferred-stubs). Children-source heuristic results
// are intentionally NOT persisted so future atlas changes still re-count
// at render time.
import fs from "node:fs";

// uuid → manual stepCount (audited via atlas MCP — see chat transcript)
const BACKFILL = {
  // ── null-heuristic entries (audited content / children) ────────────────
  "3161489a-11bd-4dea-b676-09d0cce45ae9": 3,  // Designation Process
  "aee1d848-eee8-4590-a596-1884efcb474a": 4,  // Governance Process for Instance Modification
  "023540ad-3b1b-429b-bfa7-9d740bf6ea77": 2,  // Initiation Of Agent Termination Process
  "9f87ff7a-d3a8-4999-ae20-b4c0773c732c": 1,  // Collateral Offboarding Process (single instruction, defers)
  "8ce1adeb-ec38-40ba-9a0d-bc0e0db4fece": 2,  // Emergency Declaration Procedure
  "980b1bb1-3282-48ec-aff7-54107a580bf5": 3,  // Resilience Fund Approval Process And Verifiability
  "cbf70252-fde5-4df7-8552-c778ecc3506a": 3,  // Approval Process (Resilience Research)
  "07f4faa6-f900-46e6-87d4-137fe2e5cb99": 4,  // Rewards Payout Process
  "1ccb4063-facc-42d6-a71e-21fe29e84519": 2,  // Sky Governance Process (escalation resolution)
  "510651ca-5a9a-4ac1-ba69-f3c160e185d2": 2,  // Spell Crafting Workflow
  "8eea2827-4d10-4893-92d3-9083be7e9267": 4,  // Process Definition (Atlas Edit Monthly Cycle, 4 week markers)
  "c6bcbd5f-7450-4c6e-9aa6-82c49a678bd3": 2,  // Signer Address Update If Key Accessible
  "8606cdec-f7c2-44af-befb-c702d2ed4735": 2,  // Voluntary Offboarding
  "02deeacc-5305-4a08-a5aa-2aabeb5591be": 2,  // Term-End Automatic Offboarding
  "3f3162cc-c83c-471d-9dfa-1e0ccada4261": 3,  // Approval Process (Boosted Distribution Reward)
  "05fb732b-de55-4886-81a7-7c5d4c13d2d2": 2,  // Near-Term Process (Distribution Reward)
  "07953e87-c201-4ad5-9c1e-b32efc5fba94": 3,  // Long Term Process (Distribution Reward)
  "787276c9-728b-491f-84d6-c1303fe72986": 3,  // Long Term Process (Integration Boost)
  "1ac3e606-f1c7-4a20-a9b6-a425920e98d3": 5,  // Core GovOps TRC Report Validation Process
  "dfa483c7-5adb-480e-9f82-c97cf4d0f74e": 5,  // Operational Process (Spark buyback)

  // ── bullet-source entries (last bullet is an ICD pointer, not a step) ──
  "862f4064-47e5-4f76-908d-64edfcfe0ddd": 5,  // Deposit to ERC-4626 (Spark)
  "e797d1cc-9161-4b7a-8c16-db20a026d001": 4,  // Withdraw from ERC-4626 (Spark)
  "ed774ab7-c761-444b-963d-7407bf91e243": 4,  // Redeem from ERC-4626 (Spark)
  "316008c1-0c1f-487a-a5bf-1966e86fb946": 6,  // Deposit to Aave ATokens
  "6e75a2bd-70b7-4081-bb9f-39cf6b321066": 5,  // Withdraw from Aave ATokens
  "4876005c-31a8-4be8-8133-e239bd0ac53b": 5,  // Deposit to ERC-4626 (Grove)
  "7b560160-e427-45a2-a3ac-3c23cf6fe943": 4,  // Withdraw from ERC-4626 (Grove)
  "7e90e505-42b9-474d-9cc5-9b4da6af7375": 4,  // Redeem from ERC-4626 (Grove)
  "a2f65561-ba6d-4ef0-b1c0-31da659306f3": 3,  // Signer Address Update If Key Lost (bullets = verification methods, prose has 3 steps)

  // ── deferred-stubs: skill rule says 1 (process itself, content forthcoming) ──
  "b1684804-9bd9-47a7-a080-d260609e023f": 1,  // Process For Carrying Out Changes
  "2de4d031-e079-415e-b982-66a4efa78c05": 1,  // Linear Interpolation Module Usage Process Definition
  "6bf116c0-657d-454f-8181-cc2677844513": 1,  // Signer Offboarding Requirements
  "dfd65786-e4be-4dad-9e34-cd6235a30a4f": 1,  // Process Definition For Settlement Cycle And Core GovOps Review
};

const path = "public/processes.json";
const processes = JSON.parse(fs.readFileSync(path, "utf8"));

let applied = 0;
let alreadySet = 0;
let notFound = [...Object.keys(BACKFILL)];

for (const entry of processes) {
  if (BACKFILL[entry.uuid] === undefined) continue;
  notFound = notFound.filter((u) => u !== entry.uuid);
  if (entry.stepCount !== undefined) {
    alreadySet++;
    continue;
  }
  // Rebuild the entry to keep field order stable (uuid, category, shape,
  // status, stepCount, title_at_curation, doc_no_at_curation).
  const rebuilt = {
    uuid: entry.uuid,
    category: entry.category,
    shape: entry.shape,
    status: entry.status,
    stepCount: BACKFILL[entry.uuid],
    title_at_curation: entry.title_at_curation,
    doc_no_at_curation: entry.doc_no_at_curation,
  };
  Object.assign(entry, {});
  for (const k of Object.keys(entry)) delete entry[k];
  Object.assign(entry, rebuilt);
  applied++;
}

if (notFound.length > 0) {
  console.error("UUIDs in backfill table not found in processes.json:", notFound);
  process.exit(1);
}

fs.writeFileSync(path, JSON.stringify(processes, null, 2) + "\n");
console.log(`Applied stepCount to ${applied} entries (${alreadySet} already had it).`);
