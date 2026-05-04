"use client";

import { parseUnits } from "viem";

interface DepositFormProps {
  amount: string;
  step: "idle" | "approving" | "depositing" | "done";
  isPending: boolean;
  symbol?: string;
  decimals?: number;
  balance?: bigint;
  tokenIsValid: boolean;
  currentBatchId?: bigint;
  onAmountChange: (v: string) => void;
  onApprove: () => void;
  onDeposit: () => void;
}

export function DepositForm({
  amount, step, isPending,
  symbol, decimals, balance, tokenIsValid, currentBatchId,
  onAmountChange, onApprove, onDeposit,
}: DepositFormProps) {
  const isApproved = step === "depositing";

  let amountError: string | null = null;
  if (amount && decimals != null) {
    try {
      const parsed = parseUnits(amount, decimals);
      if (parsed === 0n) amountError = "Amount must be > 0";
      if (balance != null && parsed > balance) amountError = "Amount exceeds your balance";
    } catch {
      amountError = "Invalid amount";
    }
  }

  const canApprove = tokenIsValid && !!amount && !amountError && !isApproved && !isPending;
  const canDeposit = isApproved && !isPending;

  const setMax = () => {
    if (balance != null && decimals != null) {
      onAmountChange(formatBalance(balance, decimals));
    }
  };

  return (
    <div className="space-y-5 border-t border-slate-800 pt-5">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="label !mb-0">Amount</span>
          <div className="flex items-center gap-2">
            {symbol && <span className="text-xs text-slate-500">{symbol}</span>}
            {balance != null && balance > 0n && (
              <button
                onClick={setMax}
                className="text-[11px] text-brand-green hover:underline"
              >
                Max
              </button>
            )}
          </div>
        </div>
        <input
          type="text"
          inputMode="decimal"
          placeholder={tokenIsValid ? "0.00" : "Select a token first"}
          value={amount}
          disabled={!tokenIsValid}
          onChange={(e) => onAmountChange(e.target.value)}
          className={`input-mono ${amountError ? "border-red-500/60 focus:border-red-500/60 focus:ring-red-500/30" : ""}`}
        />
        {amountError && (
          <p className="mt-1.5 text-xs text-red-400">{amountError}</p>
        )}
      </div>

      {tokenIsValid && currentBatchId != null && (
        <div className="text-[11px] text-slate-500">
          Current batch for this token:{" "}
          <span className="text-slate-300 font-mono">#{currentBatchId.toString()}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onApprove}
          disabled={!canApprove}
          className={isApproved ? "btn-ghost" : "btn-primary"}
        >
          {step === "approving" && isPending && (
            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          )}
          {isApproved ? "✓ Approved" : step === "approving" ? "Approving…" : "1 · Approve"}
        </button>

        <button
          onClick={onDeposit}
          disabled={!canDeposit}
          className="btn-primary"
        >
          {step === "depositing" && isPending && (
            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          )}
          {step === "depositing" && isPending ? "Depositing…" : "2 · Deposit 🗜️"}
        </button>
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Approval lets the Compactor pull your tokens. Deposit adds them to the
        current open batch and mints you an ERC-1155 receipt. Once the batch is
        executed, burn the receipt to claim your share of BNB.
      </p>
    </div>
  );
}

function formatBalance(balance: bigint, decimals: number): string {
  const s = balance.toString().padStart(decimals + 1, "0");
  const intPart = s.slice(0, -decimals) || "0";
  const fracPart = s.slice(-decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}
