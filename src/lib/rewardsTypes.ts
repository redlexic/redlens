// Atlas-canonical Instance statuses (A.2.2.1.3.2). An Instance is an
// operational deployment with exactly one of these values.
export type InstanceStatus = "Active" | "Suspended" | "Completed";
// Atlas Invocation status (A.2.2.1.4.1). Invocations are the in-progress act
// of enabling a Primitive — they're distinct from Instances. The atlas
// placeholder currently enumerates only "InProgress"; widen the union when
// the atlas fills in the full vocabulary.
export type InvocationStatus = "InProgress";
export type PrimitiveKind = "DR" | "IB";

export interface EntityRef {
  id: string;
  name: string;
  slug: string;
}
export interface OperationalChain {
  executor: EntityRef | null;
  govops: EntityRef | null;
}

// Shared ICD-derived shape — both Instances and Invocations are ICDs of the
// same primitives, with the same parameter shapes. The `status` type
// discriminates kind: InstanceStatus vs InvocationStatus.
export interface RewardsIcd<S> {
  id: string;
  docNo: string;
  name: string;
  status: S;
  rewardCode?: string; // DR only
  rewardCodeDocId?: string; // DR — the .1.1 Reward Code sub-doc
  partnerName?: string; // IB only
  partnerNameDocId?: string; // IB — the .1.1 Partner Name sub-doc
  rewardAddress?: string; // IB only — EVM or Solana
  rewardChain?: string; // IB only
  rewardChainDocId?: string; // IB — the .1.3 Partner Chain sub-doc
  cadence?: string; // IB only
  cadenceDocId?: string; // IB — the .1.4 Cadence sub-doc
  tracking?: string; // DR only — full methodology text incl. A-link
  // For DR: referenced methodology doc UUID if the text links out, else the
  // ICD's own Tracking Methodology sub-doc (the inline case).
  trackingDocId?: string;
  trackingDocNo?: string; // doc_no of whichever doc trackingDocId targets
  // Active Data Controller owning this instance's Payment list + its declared RP.
  paymentsControllerId?: string;
  paymentsControllerDocNo?: string;
  paymentsResponsibleParty?: EntityRef;
  // Full params extracted from the ICD's Parameters subtree. Each value is a
  // 3-tuple [formattedValue, srcUuid, srcDocNo] so consumers always have both
  // a display string and a navigation target back to the source doc for the
  // raw content. Flat for DR/IB; flattened from nested subdirectories for
  // Allocation System. Source: graph entity meta.
  params?: Record<string, ParamTuple>;
}

export type RewardsInstance = RewardsIcd<InstanceStatus>;
export type RewardsInvocation = RewardsIcd<InvocationStatus>;

/** [formattedValue, srcUuid, srcDocNo] — tuple shipped on entity meta params. */
export type ParamTuple = [string, string, string];

/** Parsed meta block on `et="instance"` GraphEntity.m. */
export interface InstanceMeta {
  agent_doc_id: string | null;
  primitive_category_doc_id: string | null;
  is_unknown_primitive?: boolean;
  status: InstanceStatus | null;
  params: Record<string, ParamTuple>;
}

/** Parsed meta block on `et="invocation"` GraphEntity.m. Same shape as
 * InstanceMeta but with the InvocationStatus union — kept separate so callers
 * can't accidentally cross-assign. */
export interface InvocationMeta {
  agent_doc_id: string | null;
  primitive_category_doc_id: string | null;
  is_unknown_primitive?: boolean;
  status: InvocationStatus | null;
  params: Record<string, ParamTuple>;
}

export interface AgentPrimitive {
  kind: PrimitiveKind;
  primitiveId: string;
  primitiveDocNo: string;
  globalActivation: string | null;
  active: RewardsInstance[];
  suspended: RewardsInstance[];
  completed: RewardsInstance[];
  invocations: RewardsInvocation[];
}

export interface RewardsAgent {
  name: string;
  docNoPrefix: string;
  agentEntity: EntityRef | null;
  chain: OperationalChain | null;
  dr: AgentPrimitive | null;
  ib: AgentPrimitive | null;
}

export interface RewardsEcosystemNode {
  id: string;
  docNo: string;
  title: string;
  description: string;
}

export interface RewardsIndex {
  agents: RewardsAgent[];
  stUsdsDr: RewardsEcosystemNode | null;
  srUsdsDr: RewardsEcosystemNode | null;
  drPrimitive: RewardsEcosystemNode | null;
  ibPrimitive: RewardsEcosystemNode | null;
  demandSideBufferAddress: string;
}
