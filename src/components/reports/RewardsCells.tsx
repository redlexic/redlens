import type { AddressInfo } from "../../types";
import type { EntityRef } from "../../lib/rewardsIndex";

export function EntityChip({ e, onEntity }: { e: EntityRef; onEntity: (slug: string) => void }) {
  return (
    <button
      onClick={() => onEntity(e.slug)}
      className="text-[11px] text-accent hover:underline mono"
    >
      {e.name}
    </button>
  );
}

function explorerFor(
  addr: string,
  chain: string | undefined,
  addrMap: Record<string, AddressInfo>,
): string {
  const known = addrMap[addr.toLowerCase()] ?? addrMap[addr];
  if (known?.explorerUrl) return known.explorerUrl;
  const c = (chain ?? "").toLowerCase();
  if (c.includes("solana")) return `https://solscan.io/account/${addr}`;
  if (c.includes("base")) return `https://basescan.org/address/${addr}`;
  if (c.includes("arbitrum")) return `https://arbiscan.io/address/${addr}`;
  if (c.includes("optimism")) return `https://optimistic.etherscan.io/address/${addr}`;
  return `https://etherscan.io/address/${addr}`;
}

const STATUS_STYLE: Record<string, string> = {
  Active: "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-tan",
  Completed: "bg-[var(--hover)] text-tan-3",
  InProgress: "bg-[color-mix(in_srgb,var(--tan-3)_20%,transparent)] text-tan-2",
};

export function StatusPill({ s }: { s: string }) {
  return (
    <span className={`mono text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[s] ?? ""}`}>{s}</span>
  );
}

export function AddressLink({
  addr,
  chain,
  addrMap,
}: {
  addr: string;
  chain?: string;
  addrMap: Record<string, AddressInfo>;
}) {
  const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  const info = addrMap[addr.toLowerCase()] ?? addrMap[addr];
  const label = info?.label ?? null;
  return (
    <a
      href={explorerFor(addr, chain, addrMap)}
      target="_blank"
      rel="noopener"
      className="mono text-[11px] text-accent hover:underline"
      title={addr}
    >
      {label ? `${label} · ${short}` : short}
    </a>
  );
}
