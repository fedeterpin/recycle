"use client";

import { useWriteContract, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { useAccount } from "wagmi";
import { parseUnits, type Address } from "viem";
import CompactorABI from "@/lib/abis/Compactor.json";
import { ERC20_ABI } from "@/lib/abis/erc20";

const COMPACTOR = process.env.NEXT_PUBLIC_COMPACTOR_ADDRESS as Address;

/// @notice Drives the two-step approve → deposit flow for the Compactor.
///         Mirrors useBurn's shape so the state machine in CompactorModule
///         can use the same wagmi-driven transitions.
export function useDeposit(tokenAddress?: Address) {
  const { address } = useAccount();

  const { data: tokenDecimals } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
    query: { enabled: Boolean(tokenAddress) },
  });

  const { writeContract: approve, data: approveTxHash } = useWriteContract();
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });

  const {
    writeContract: depositWrite,
    data: depositTxHash,
    isPending,
    isSuccess,
  } = useWriteContract();

  const approveDeposit = (token: Address, amount: string) => {
    if (!address) return;
    const decimals = (tokenDecimals as number | undefined) ?? 18;
    const amountBn = parseUnits(amount, decimals);

    approve({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [COMPACTOR, amountBn],
    });
  };

  const executeDeposit = (token: Address, amount: string) => {
    if (!approveConfirmed) return;
    const decimals = (tokenDecimals as number | undefined) ?? 18;
    const amountBn = parseUnits(amount, decimals);

    depositWrite({
      address: COMPACTOR,
      abi: CompactorABI,
      functionName: "depositDust",
      args: [token, amountBn],
    });
  };

  return {
    approveDeposit,
    executeDeposit,
    approveConfirmed,
    isPending,
    isSuccess,
    txHash: depositTxHash,
  };
}

export function useClaim() {
  const {
    writeContract,
    data: txHash,
    isPending,
    isSuccess,
  } = useWriteContract();

  const claim = (token: Address, batchId: bigint, receiptAmount: bigint) => {
    writeContract({
      address: COMPACTOR,
      abi: CompactorABI,
      functionName: "claimBNB",
      args: [token, batchId, receiptAmount],
    });
  };

  return { claim, isPending, isSuccess, txHash };
}

export function useRedeem() {
  const {
    writeContract,
    data: txHash,
    isPending,
    isSuccess,
  } = useWriteContract();

  const redeem = (token: Address, batchId: bigint, receiptAmount: bigint) => {
    writeContract({
      address: COMPACTOR,
      abi: CompactorABI,
      functionName: "redeemDust",
      args: [token, batchId, receiptAmount],
    });
  };

  return { redeem, isPending, isSuccess, txHash };
}
