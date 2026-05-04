"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseAbiItem, type Address } from "viem";
import { CONTRACTS } from "@/lib/contracts";

export interface BurnEvent {
  user: Address;
  token: Address;
  amount: bigint;
  usdValue: bigint;
  rcyRewarded: bigint;
  certificateId: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp: number; // unix seconds
}

const LOG_BURN_EVENT = parseAbiItem(
  "event LogBurn(address indexed user, address indexed token, uint256 amount, uint256 usdValue, uint256 rcyRewarded, uint256 certificateId)"
);

interface Filter {
  user?: Address;
}

export function useBurnHistory(filter?: Filter) {
  const client = usePublicClient();
  const [events, setEvents] = useState<BurnEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const userFilter = filter?.user;

  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (!client) return;

        const logs = await client.getLogs({
          address: CONTRACTS.incinerator.address,
          event: LOG_BURN_EVENT,
          args: userFilter ? { user: userFilter } : undefined,
          fromBlock: 0n,
          toBlock: "latest",
        });

        // Fetch each unique block's timestamp once.
        const uniqueBlocks = Array.from(new Set(logs.map((l) => l.blockNumber!)));
        const blockToTs = new Map<bigint, number>();
        await Promise.all(
          uniqueBlocks.map(async (bn) => {
            const block = await client.getBlock({ blockNumber: bn });
            blockToTs.set(bn, Number(block.timestamp));
          })
        );

        if (cancelled) return;

        const decoded: BurnEvent[] = logs.map((log) => ({
          user: log.args.user!,
          token: log.args.token!,
          amount: log.args.amount!,
          usdValue: log.args.usdValue!,
          rcyRewarded: log.args.rcyRewarded!,
          certificateId: log.args.certificateId!,
          txHash: log.transactionHash!,
          blockNumber: log.blockNumber!,
          timestamp: blockToTs.get(log.blockNumber!) ?? 0,
        }));

        // Most recent first.
        decoded.sort((a, b) => Number(b.blockNumber - a.blockNumber));

        setEvents(decoded);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [client, userFilter]);

  return { events, loading, error };
}
