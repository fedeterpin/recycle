"use client";

import { useEffect, useState } from "react";
import { useReadContract, useAccount } from "wagmi";
import { isAddress, type Address } from "viem";
import { useDeposit } from "@/hooks/useCompactor";
import { ERC20_ABI } from "@/lib/abis/erc20";
import { CONTRACTS } from "@/lib/contracts";
import { TokenSelector } from "@/components/incinerator/TokenSelector";
import { DepositForm } from "./DepositForm";
import { ReceiptList } from "./ReceiptList";

type Step = "idle" | "approving" | "depositing" | "done";
type Tab = "deposit" | "receipts";

export function CompactorModule() {
  const { address, isConnected } = useAccount();
  const [tab, setTab] = useState<Tab>("deposit");
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  const validToken = isAddress(token) ? (token as Address) : undefined;

  const { approveDeposit, executeDeposit, approveConfirmed, isPending, isSuccess, txHash } =
    useDeposit(validToken);

  const { data: protocolFeeBps } = useReadContract({
    address: CONTRACTS.compactor.address,
    abi: CONTRACTS.compactor.abi,
    functionName: "protocolFeeBps",
  });

  const { data: tokenSymbol } = useReadContract({
    address: validToken,
    abi: ERC20_ABI,
    functionName: "symbol",
    query: { enabled: Boolean(validToken) },
  });
  const { data: tokenDecimals } = useReadContract({
    address: validToken,
    abi: ERC20_ABI,
    functionName: "decimals",
    query: { enabled: Boolean(validToken) },
  });
  const { data: tokenBalance } = useReadContract({
    address: validToken,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(validToken && address) },
  });
  const { data: currentBatchId } = useReadContract({
    address: CONTRACTS.compactor.address,
    abi: CONTRACTS.compactor.abi,
    functionName: "currentBatchId",
    args: validToken ? [validToken] : undefined,
    query: { enabled: Boolean(validToken) },
  });

  useEffect(() => {
    if (approveConfirmed && step === "approving") setStep("depositing");
  }, [approveConfirmed, step]);

  useEffect(() => {
    if (isSuccess && step === "depositing") setStep("done");
  }, [isSuccess, step]);

  const handleApprove = () => {
    if (!validToken) return;
    setError(null);
    setStep("approving");
    try {
      approveDeposit(validToken, amount);
    } catch (e) {
      setError(formatErr(e));
      setStep("idle");
    }
  };

  const handleDeposit = () => {
    if (!validToken) return;
    setError(null);
    setStep("depositing");
    try {
      executeDeposit(validToken, amount);
    } catch (e) {
      setError(formatErr(e));
      setStep("approving");
    }
  };

  const reset = () => {
    setStep("idle");
    setAmount("");
    setError(null);
  };

  return (
    <div className="max-w-2xl mx-auto px-2 animate-fade-in">
      <header className="text-center mt-6 mb-8">
        <div className="text-5xl mb-3">🗜️</div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Compactor</h1>
        <p className="text-slate-400 max-w-md mx-auto">
          Pool dust into a per-token batch. Once the multisig executes the swap,
          burn your receipt to claim BNB pro-rata.
        </p>
        {protocolFeeBps != null && (
          <div className="mt-4 inline-flex items-center gap-2">
            <span className="pill-yellow">
              Protocol fee: {(Number(protocolFeeBps) / 100).toFixed(2)}%
            </span>
          </div>
        )}
      </header>

      <div className="flex justify-center mb-6">
        <div className="inline-flex bg-slate-900/60 border border-slate-800 rounded-xl p-1">
          <TabButton active={tab === "deposit"} onClick={() => setTab("deposit")}>
            Deposit dust
          </TabButton>
          <TabButton active={tab === "receipts"} onClick={() => setTab("receipts")}>
            My receipts
          </TabButton>
        </div>
      </div>

      {tab === "deposit" ? (
        !isConnected ? (
          <div className="card p-10 text-center">
            <div className="text-4xl mb-3">👛</div>
            <h2 className="text-lg font-semibold mb-1">Connect your wallet</h2>
            <p className="text-slate-400 text-sm">Use the button in the top-right to connect.</p>
          </div>
        ) : step === "done" ? (
          <div className="card p-8 text-center animate-slide-up">
            <div className="text-5xl mb-3">✅</div>
            <h2 className="text-xl font-semibold mb-1">Dust deposited</h2>
            <p className="text-slate-400 text-sm mb-6">
              Your ERC-1155 receipt has been minted. Once the multisig executes
              the batch, head to “My receipts” to claim BNB.
            </p>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 mb-6 text-left text-xs font-mono break-all">
              <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">
                Transaction
              </div>
              {txHash}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button onClick={() => setTab("receipts")} className="btn-primary">
                View my receipts
              </button>
              <button onClick={reset} className="btn-ghost">
                Deposit more
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 animate-slide-up">
            <div className="card p-6 space-y-5">
              <TokenSelector
                owner={address}
                selected={token}
                onSelect={(addr) => { setToken(addr); setAmount(""); }}
              />

              <DepositForm
                amount={amount}
                step={step}
                isPending={isPending}
                symbol={tokenSymbol as string | undefined}
                decimals={tokenDecimals as number | undefined}
                balance={tokenBalance as bigint | undefined}
                tokenIsValid={Boolean(validToken)}
                currentBatchId={currentBatchId as bigint | undefined}
                onAmountChange={setAmount}
                onApprove={handleApprove}
                onDeposit={handleDeposit}
              />
            </div>

            {error && (
              <div className="card p-4 border-red-500/40 bg-red-500/5 text-sm text-red-200">
                <strong className="text-red-300">Error:</strong> {error}
              </div>
            )}
          </div>
        )
      ) : (
        <ReceiptList />
      )}
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-slate-800 text-white"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function formatErr(e: unknown): string {
  if (e instanceof Error) return e.message.split("\n")[0];
  return String(e);
}
