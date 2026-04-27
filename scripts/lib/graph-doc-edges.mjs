/**
 * Phase 2 doc-structure edges (2a–2h) extraction for build-graph.
 *
 * Emits parent_of, annotates, active_data_for, cites, implements,
 * instance_of + invoked_by, located_at, and has_status edges.
 */

import {
  isAnnotation, isActiveData, UUID_LINK_RE, isICDLocation, isICD,
  isGlobalActivationStatus, ancestorByStripping,
} from "./graph-patterns.mjs";
import { INSTANCE_SCOPED_PRIMITIVES, instanceStatusFor } from "./graph-instances.mjs";

export function extractDocEdges(allDocs, docById, docByDocNo, entityByDocId) {
  const edges = [];
  const docIds = new Set(allDocs.map(d => d.id));

  function addEdge(fromId, fromType, toId, toType, edgeType, sourceDocNos = [], meta = null) {
    edges.push({ fromId, fromType, toId, toType, edgeType, sourceDocNos, meta });
  }

  // --- 2a. parent_of (from parentId) ---
  for (const d of allDocs) {
    if (d.parentId && docById.has(d.parentId)) {
      addEdge(d.parentId, "doc", d.id, "doc", "parent_of", []);
    }
  }

  // --- 2b. annotates (*.0.3.X, *.0.4.X, *.varX) ---
  for (const d of allDocs.filter(isAnnotation)) {
    if (d.parentId) addEdge(d.id, "doc", d.parentId, "doc", "annotates", [d.doc_no]);
  }

  // --- 2c. active_data_for (*.0.6.X → containing ADC) ---
  // The AD section's doc-tree parent may be several levels above the ADC because
  // build-index caps heading depth at 6. Resolve the ADC by stripping the trailing
  // `.0.6.N` segments from the AD section's doc_no instead.
  for (const d of allDocs.filter(isActiveData)) {
    const adc = ancestorByStripping(d, 3, docByDocNo);
    if (adc) addEdge(d.id, "doc", adc.id, "doc", "active_data_for", [d.doc_no]);
  }

  // --- 2d. cites (UUID markdown links) ---
  let citeCount = 0;
  const citedByDoc = new Map();
  for (const d of allDocs) {
    const seen = citedByDoc.get(d.id) ?? new Set();
    for (const m of (d.content ?? "").matchAll(UUID_LINK_RE)) {
      const targetId = m[2];
      if (docIds.has(targetId) && targetId !== d.id && !seen.has(targetId)) {
        seen.add(targetId);
        addEdge(d.id, "doc", targetId, "doc", "cites", [d.doc_no]);
        citeCount++;
      }
    }
    citedByDoc.set(d.id, seen);
  }
  console.log(`  ${citeCount} cites edges`);

  // --- 2e. implements (primitive root → global primitive in A.2.2) ---
  const IMPLEMENTS_RE = /\bSee\s+\[([^\]]+)\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i;
  for (const d of allDocs) {
    if (!d.doc_no.startsWith("A.6.1.1.")) continue;
    const m = (d.content ?? "").match(IMPLEMENTS_RE);
    if (!m) continue;
    const targetDoc = docById.get(m[2]);
    if (targetDoc && targetDoc.doc_no.startsWith("A.2.2.")) {
      addEdge(d.id, "doc", targetDoc.id, "doc", "implements", [d.doc_no]);
    }
  }

  // --- 2f. instance_of (ICD → primitive root). Meta carries the derived status
  // for in-scope primitives; out-of-scope ICDs still get the edge but no status.
  // Also emit entity→entity `invoked_by` from the Instance to its Prime Agent
  // so instances surface in the entity graph clustered around their agent. ---
  for (const d of allDocs.filter(d => isICD(d) && d.doc_no.startsWith("A.6.1.1."))) {
    // Inline primitiveRootFor so we don't need to re-import it here.
    const m = d.doc_no.match(/^(A\.6\.1\.1\.\d+\.2\.\d+\.\d+)(?:$|\.)/);
    if (!m) continue;
    const primRoot = docByDocNo.get(m[1]);
    if (!primRoot || !/Primitive$/i.test(primRoot.title)) continue;
    const inScope = !!INSTANCE_SCOPED_PRIMITIVES[primRoot.title];
    const status = inScope ? instanceStatusFor(d, primRoot, docByDocNo) : null;
    const meta = status ? JSON.stringify({ status }) : null;
    addEdge(d.id, "doc", primRoot.id, "doc", "instance_of", [d.doc_no], meta);

    if (!inScope) continue;
    const agentDocNo = d.doc_no.match(/^(A\.6\.1\.1\.\d+)(?:\.|$)/)?.[1];
    const agentDoc = agentDocNo ? docByDocNo.get(agentDocNo) : null;
    const primeEntity = agentDoc ? entityByDocId.get(agentDoc.id) : null;
    if (primeEntity) {
      addEdge(d.id, "entity", primeEntity.id, "entity", "invoked_by", [d.doc_no], meta);
    }
  }

  // --- 2g. located_at (ICD Location → ICD) ---
  for (const d of allDocs.filter(isICDLocation)) {
    for (const m of (d.content ?? "").matchAll(UUID_LINK_RE)) {
      const targetDoc = docById.get(m[2]);
      if (targetDoc && isICD(targetDoc)) {
        addEdge(d.id, "doc", targetDoc.id, "doc", "located_at", [d.doc_no]);
        break;
      }
    }
  }

  // --- 2h. has_status (primitive root → Global Activation Status) ---
  for (const d of allDocs.filter(d => isGlobalActivationStatus(d) && d.doc_no.startsWith("A.6.1.1."))) {
    const primRoot = ancestorByStripping(d, 2, docByDocNo);
    if (primRoot) addEdge(primRoot.id, "doc", d.id, "doc", "has_status", [primRoot.doc_no]);
  }

  return edges;
}
