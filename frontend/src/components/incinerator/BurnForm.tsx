"use client";

import { parseUnits } from "viem";

interface BurnFormProps {
  amount: string;
  step: "idle" | "approving" | "burning" | "done";
  isPending: boolean;
  symbol?: string;
  decimals?: number;
  balance?: bigint;
  tokenIsValid: boolean;
  onAmountChange: (v: string) => void;
  onApprove: () => void;
  onBurn: () => void;
}

export function BurnForm({
  amount, step, isPending,
  symbol, decimals, balance, tokenIsValid,
  onAmountChange, onApprove, onBurn,
}: BurnFormProps) {
  const isApproved = step === "burning";

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
  const canBurn    = isApproved && !isPending;

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
          onClick={onBurn}
          disabled={!canBurn}
          className="btn-danger"
        >
          {step === "burning" && isPending && (
            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          )}
          {step === "burning" && isPending ? "Burning…" : "2 · Burn 🔥"}
        </button>
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Approval lets the Incinerator pull your tokens. The burn pays a flat BNB fee,
        sends the tokens to the Vault, mints your Loss Certificate NFT, and credits $RCY.
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
