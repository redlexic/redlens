export type InstanceStatus = "Active" | "Completed" | "InProgress";
export type PrimitiveKind = "DR" | "IB";

export interface EntityRef { id: string; name: string; slug: string; }
export interface OperationalChain { executor: EntityRef | null; govops: EntityRef | null; }

export interface RewardsInstance {
  id: string;
  docNo: string;
  name: string;
  status: InstanceStatus;
  rewardCode?: string;    // DR only
  partnerName?: string;   // IB only
  rewardAddress?: string; // IB only — EVM or Solana
  rewardChain?: string;   // IB only
  cadence?: string;       // IB only
  tracking?: string;      // DR only — full methodology text incl. A-link
  // Active Data Controller owning this instance's Payment list + its declared RP.
  paymentsControllerId?: string;
  paymentsControllerDocNo?: string;
  paymentsResponsibleParty?: EntityRef;
}

export interface AgentPrimitive {
  kind: PrimitiveKind;
  primitiveId: string;
  primitiveDocNo: string;
  globalActivation: string | null;
  active: RewardsInstance[];
  completed: RewardsInstance[];
  inProgress: RewardsInstance[];
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
