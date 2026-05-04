"use client";

import { useEffect, useState } from "react";
import { usePublicClient, useChainId } from "wagmi";
import { type Address, getAddress, parseAbiItem } from "viem";
import { ERC20_ABI } from "@/lib/abis/erc20";

export interface WalletToken {
  address: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
}

interface Result {
  tokens: WalletToken[];
  loading: boolean;
  /// Auto-discovery isn't viable on this chain (e.g. mainnets without an indexer).
  unsupported: boolean;
  refetch: () => void;
}

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/// @notice Discovers ERC-20 tokens held by `owner` by scanning Transfer logs
///         where the user is the recipient, then reading current balance.
///         Only attempted on local Hardhat (chainId 31337) where the chain is
///         small. Mainnets fall back to manual address entry.
export function useWalletTokens(owner: Address | undefined): Result {
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const [tokens, setTokens] = useState<WalletToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const unsupported = chainId !== 31337;

  useEffect(() => {
    if (!owner || !publicClient || unsupported) {
      setTokens([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const logs = await publicClient.getLogs({
          event: TRANSFER_EVENT,
          args: { to: owner },
          fromBlock: 0n,
          toBlock: "latest",
        });

        const unique = new Set<string>();
        for (const log of logs) {
          if (log.address) unique.add(getAddress(log.address));
        }
        const candidates = Array.from(unique) as Address[];

        const enriched = await Promise.all(
          candidates.map(async (address) => {
            try {
              const [balance, symbol, decimals] = await Promise.all([
                publicClient.readContract({
                  address, abi: ERC20_ABI, functionName: "balanceOf", args: [owner],
                }),
                publicClient.readContract({
                  address, abi: ERC20_ABI, functionName: "symbol",
                }).catch(() => "UNKNOWN"),
                publicClient.readContract({
                  address, abi: ERC20_ABI, functionName: "decimals",
                }).catch(() => 18),
              ]);

              return {
                address,
                balance: balance as bigint,
                symbol: String(symbol),
                decimals: Number(decimals),
              } satisfies WalletToken;
            } catch {
              return null;
            }
          }),
        );

        const withBalance = enriched
          .filter((t): t is WalletToken => t != null && t.balance > 0n)
          .sort((a, b) => a.symbol.localeCompare(b.symbol));

        if (!cancelled) setTokens(withBalance);
      } catch (err) {
        console.error("[useWalletTokens] scan failed:", err);
        if (!cancelled) setTokens([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [owner, publicClient, unsupported, refreshKey]);

  return { tokens, loading, unsupported, refetch: () => setRefreshKey((k) => k + 1) };
}
