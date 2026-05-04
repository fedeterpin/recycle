"use client";

import { useWriteContract, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { useAccount } from "wagmi";
import { parseUnits, type Address } from "viem";
import IncineratorABI from "@/lib/abis/Incinerator.json";
import { ERC20_ABI } from "@/lib/abis/erc20";

const INCINERATOR = process.env.NEXT_PUBLIC_INCINERATOR_ADDRESS as Address;

/// @notice Drives the two-step approve → burn flow for the Incinerator.
///         Reads the burn target token's decimals on-chain so amounts entered
///         in the UI are scaled correctly regardless of token precision.
export function useBurn(tokenAddress?: Address) {
  const { address } = useAccount();

  const { data: flatFee } = useReadContract({
    address: INCINERATOR,
    abi: IncineratorABI,
    functionName: "flatFee",
  });

  const { data: tokenDecimals } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
    query: { enabled: Boolean(tokenAddress) },
  });

  const { writeContract: approve, data: approveTxHash } = useWriteContract();
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });

  const { writeContract: burnWrite, data: burnTxHash, isPending, isSuccess } = useWriteContract();

  const burn = (token: Address, amount: string) => {
    if (!address) return;
    const decimals = (tokenDecimals as number | undefined) ?? 18;
    const amountBn = parseUnits(amount, decimals);

    approve({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [INCINERATOR, amountBn],
    });
  };

  const executeBurn = (token: Address, amount: string) => {
    // Both must be ready: approval confirmed AND fee loaded. Previously this
    // used &&, which caused the burn to fire before the approval landed.
    if (!approveConfirmed || flatFee == null) return;
    const decimals = (tokenDecimals as number | undefined) ?? 18;
    const amountBn = parseUnits(amount, decimals);

    burnWrite({
      address: INCINERATOR,
      abi: IncineratorABI,
      functionName: "burn",
      args: [token, amountBn],
      value: flatFee as bigint,
    });
  };

  return { burn, executeBurn, approveConfirmed, flatFee, isPending, isSuccess, txHash: burnTxHash };
}
