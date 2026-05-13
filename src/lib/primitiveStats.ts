import type { AtlasNode } from "../types";
import type { GraphData } from "./graph";
import type { InstanceMeta } from "./rewardsTypes";
import { parseMeta } from "./meta";

const CURRENT_PRIMITIVES_UUID = "203b8c79-c7cf-4fcc-94e3-5bf42f791619";

export interface PrimitiveStat {
  title: string;
  st: string;
  docId: string | null;
  pending: number;
  active: number;
  suspended: number;
  completed: number;
}

export interface CategoryStat {
  title: string;
  docId: string | null;
  primitives: PrimitiveStat[];
}

export interface AgentPrimitiveStat {
  name: string;
  slug: string;
  docId: string;
  executorName: string | null;
  executorSlug: string | null;
  categories: CategoryStat[];
}

/** Canonical category names in atlas order, parsed from the Current Primitives doc. */
function canonicalCategories(docs: Record<string, AtlasNode>): string[] {
  const doc = docs[CURRENT_PRIMITIVES_UUID];
  if (!doc?.content) return [];
  return doc.content
    .split("\n")
    .filter((l) => /^-\s/.test(l))
    .map((l) => l.replace(/^-\s+/, "").trim());
}

/**
 * Build a map of category title → doc UUID using implements edges.
 * Targets of implements edges whose title matches a canonical category are the
 * global category definitions — stable navigation targets even for zero-instance
 * categories on a given agent.
 */
function globalCategoryDocIds(
  graph: GraphData,
  docs: Record<string, AtlasNode>,
  categoryNames: Set<string>,
): Map<string, string> {
  const targets = new Set(
    graph.edges.filter((e) => e.e === "implements" && e.ft === "doc").map((e) => e.t),
  );
  const result = new Map<string, string>();
  for (const [id, doc] of Object.entries(docs)) {
    if (targets.has(id) && categoryNames.has(doc.title)) result.set(doc.title, id);
  }
  return result;
}

export function buildPrimitiveStats(
  graph: GraphData,
  docs: Record<string, AtlasNode>,
): AgentPrimitiveStat[] {
  const orderedCategories = canonicalCategories(docs);
  const categoryNameSet = new Set(orderedCategories);
  const globalCatDocId = globalCategoryDocIds(graph, docs, categoryNameSet);

  const instanceOfMap = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.e === "instance_of" && e.ft === "doc" && e.tt === "doc") instanceOfMap.set(e.f, e.t);
  }

  const entityById = new Map(
    [...graph.participants, ...graph.instances, ...graph.primitives].map((e) => [e.id, e]),
  );
  // executor slug/name per prime agent id
  const executorByPrimeId = new Map<string, { name: string; slug: string }>();
  for (const e of graph.edges) {
    if (e.e === "operational_executor_agent_for" && e.ft === "entity" && e.tt === "entity") {
      const exec = entityById.get(e.f);
      if (exec) executorByPrimeId.set(e.t, { name: exec.name, slug: exec.slug });
    }
  }

  type AgentBucket = {
    name: string; slug: string; docId: string;
    catMap: Map<string, { docId: string | null; primMap: Map<string, PrimitiveStat> }>;
  };
  const agentMap = new Map<string, AgentBucket>();
  for (const p of graph.participants.filter((e) => e.et === "agent" && e.st === "prime")) {
    agentMap.set(p.id, { name: p.name, slug: p.slug, docId: p.id, catMap: new Map() });
  }

  for (const inst of graph.instances) {
    if (!inst.m || !inst.st) continue;
    const meta = parseMeta<InstanceMeta>(inst.m);
    if (!meta?.agent_doc_id) continue;
    const bucket = agentMap.get(meta.agent_doc_id);
    if (!bucket) continue;

    const catDocId = meta.primitive_category_doc_id ?? null;
    const catTitle = catDocId ? (docs[catDocId]?.title ?? "Unknown") : "Unknown";
    if (!bucket.catMap.has(catTitle)) bucket.catMap.set(catTitle, { docId: catDocId, primMap: new Map() });
    const { primMap } = bucket.catMap.get(catTitle)!;

    const primitiveDocId = instanceOfMap.get(inst.id) ?? null;
    const primitiveTitle = primitiveDocId
      ? (docs[primitiveDocId]?.title?.replace(/ Primitive$/i, "") ?? inst.st)
      : inst.st;

    if (!primMap.has(inst.st)) {
      primMap.set(inst.st, { title: primitiveTitle, st: inst.st, docId: primitiveDocId, pending: 0, active: 0, suspended: 0, completed: 0 });
    }
    const stat = primMap.get(inst.st)!;
    if (meta.status === "Active") stat.active++;
    else if (meta.status === "Completed") stat.completed++;
    else if (meta.status === "Pending") stat.pending++;
    else stat.active++;
  }

  return [...agentMap.values()]
    .map((a) => {
      // Build ordered categories, filling in zeros for missing ones.
      const categories: CategoryStat[] = orderedCategories.map((title) => {
        const existing = a.catMap.get(title);
        return {
          title,
          docId: existing?.docId ?? globalCatDocId.get(title) ?? null,
          primitives: existing ? [...existing.primMap.values()] : [],
        };
      });
      // Append any non-canonical categories (unknown/future primitives).
      for (const [title, { docId, primMap }] of a.catMap) {
        if (!categoryNameSet.has(title)) {
          categories.push({ title, docId, primitives: [...primMap.values()] });
        }
      }
      const exec = executorByPrimeId.get(a.docId) ?? null;
      return { name: a.name, slug: a.slug, docId: a.docId, executorName: exec?.name ?? null, executorSlug: exec?.slug ?? null, categories };
    })
    .sort((a, b) => {
      const da = docs[a.docId]?.doc_no ?? "";
      const db = docs[b.docId]?.doc_no ?? "";
      return da.localeCompare(db, undefined, { numeric: true });
    });
}
