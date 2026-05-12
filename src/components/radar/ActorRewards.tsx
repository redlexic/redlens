import type { RewardsAgent } from "../../lib/rewardsIndex";
import { PrimitiveTable } from "../reports/RewardsPrimitiveTable";
import { useRadar } from "./RadarContext";

interface Props {
  agent: RewardsAgent;
}

export function ActorRewards({ agent }: Props) {
  const { onNavigate, onActor } = useRadar();
  const onEntity = (slug: string) => onActor(slug);

  if (!agent.dr && !agent.ib) {
    return (
      <p className="text-xs italic" style={{ color: "var(--tan-3)" }}>
        No DR or IB instances for this agent.
      </p>
    );
  }

  return (
    <div>
      {agent.dr && (
        <PrimitiveTable
          agent={agent}
          prim={agent.dr}
          onNavigate={onNavigate}
          onEntity={onEntity}
          addrMap={{}}
        />
      )}
      {agent.ib && (
        <PrimitiveTable
          agent={agent}
          prim={agent.ib}
          onNavigate={onNavigate}
          onEntity={onEntity}
          addrMap={{}}
        />
      )}
    </div>
  );
}
