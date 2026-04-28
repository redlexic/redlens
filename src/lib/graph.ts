import type {
  ResolvedEdge,
  Participant,
  RelationEdge,
  GraphWorkerOutMessage,
} from "../types";
import { fetchJsonVerified } from "./verify";

export interface GraphData {
  participants: Participant[]; // agents, parties, facilitators, govops, delegates — et !== "instance"
  instances: Participant[]; // primitive instances — et === "instance"
  edges: RelationEdge[];
}

// Module-level cache for the raw graph data (used by reports)
let graphCache: Promise<GraphData> | null = null;

/** Load the full relations.json once and cache it. Used by reports that need bulk data. */
export function loadGraph(): Promise<GraphData> {
  if (!graphCache) {
    graphCache = fetchJsonVerified<{ entities: Participant[]; edges: RelationEdge[] }>(
      `${import.meta.env.BASE_URL}relations.json`,
      "relations.json",
    ).then((data) => ({
      participants: data.entities.filter((e) => e.et !== "instance"),
      instances: data.entities.filter((e) => e.et === "instance"),
      edges: data.edges,
    }));
  }
  return graphCache;
}

export interface EdgeResult {
  outbound: ResolvedEdge[];
  inbound: ResolvedEdge[];
}

// ---------------------------------------------------------------------------
// Worker lifecycle — started lazily on first call, kept alive for the session
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let ready = false;
const readyCallbacks: Array<() => void> = [];

// Pending query callbacks keyed by request id
const edgePending = new Map<string, (r: EdgeResult) => void>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("../workers/graph.worker.ts", import.meta.url), { type: "module" });

  worker.addEventListener("message", (e: MessageEvent<GraphWorkerOutMessage>) => {
    const msg = e.data;

    if (msg.type === "ready") {
      ready = true;
      for (const cb of readyCallbacks) cb();
      readyCallbacks.length = 0;
      return;
    }

    if (msg.type === "edges") {
      const cb = edgePending.get(msg.id);
      if (cb) {
        edgePending.delete(msg.id);
        cb({ outbound: msg.outbound, inbound: msg.inbound });
      }
      return;
    }

  });

  return worker;
}

function whenReady(): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => readyCallbacks.push(resolve));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get all inbound + outbound edges for a doc or entity id. */
export async function getEdges(id: string): Promise<EdgeResult> {
  const w = getWorker();
  await whenReady();
  return new Promise((resolve) => {
    edgePending.set(id, resolve);
    w.postMessage({ type: "edges", id });
  });
}
