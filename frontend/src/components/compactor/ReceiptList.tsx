"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { useClaim, useRedeem } from "@/hooks/useCompactor";

interface Receipt {
  token_address: string;
  batch_id: number;
  current_amount: string;        // raw integer string (token-decimals)
  status: "OPEN" | "EXECUTED" | "FAILED";
  bnb_for_users?: string | null; // raw wei
  total_receipts?: string | null;
  symbol?: string | null;
  decimals?: number | null;
}

const API = process.env.NEXT_PUBLIC_API_URL;

export function ReceiptList() {
  const { address } = useAccount();
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { claim, isPending: claimPending, isSuccess: claimSuccess } = useClaim();
  const { redeem, isPending: redeemPending, isSuccess: redeemSuccess } = useRedeem();

  async function refresh() {
    if (!address || !API) return;
    try {
      const res = await fetch(`${API}/compactor/receipts?wallet=${address}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Receipt[] = await res.json();
      setReceipts(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8_000);
    return () => clearInterval(id);
  }, [address]);

  // Refresh after a successful claim/redeem so the UI reflects new state.
  useEffect(() => {
    if (claimSuccess || redeemSuccess) {
      setBusy(null);
      refresh();
    }
  }, [claimSuccess, redeemSuccess]);

  if (!address) {
    return (
      <div className="card p-10 text-center">
        <div className="text-4xl mb-3">👛</div>
        <h2 className="text-lg font-semibold mb-1">Connect your wallet</h2>
        <p className="text-slate-400 text-sm">Use the button in the top-right to connect.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6 border-red-500/40 bg-red-500/5 text-sm text-red-200">
        <strong className="text-red-300">Error loading receipts:</strong> {error}
      </div>
    );
  }

  if (receipts == null) {
    return (
      <div className="card p-6 text-sm text-slate-400 flex items-center gap-2">
        <span className="inline-block w-3 h-3 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
        Loading receipts…
      </div>
    );
  }

  if (receipts.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-4xl mb-3">🗜️</div>
        <h2 className="text-lg font-semibold mb-1">No receipts yet</h2>
        <p className="text-slate-400 text-sm">
          Deposit some dust on the Deposit tab to receive your first receipt.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {receipts.map((r) => {
        const key = `${r.token_address}-${r.batch_id}`;
        const decimals = r.decimals ?? 18;
        const amount = BigInt(r.current_amount);
        const symbol = r.symbol ?? "TOKEN";

        const isClaimable = r.status === "EXECUTED" && amount > 0n;
        const isRedeemable = r.status === "FAILED" && amount > 0n;

        const bnbForUsers = r.bnb_for_users ? BigInt(r.bnb_for_users) : 0n;
        const totalReceipts = r.total_receipts ? BigInt(r.total_receipts) : 0n;
        const expectedPayout =
          isClaimable && totalReceipts > 0n
            ? (amount * bnbForUsers) / totalReceipts
            : 0n;

        const onClaim = () => {
          setBusy(key);
          claim(r.token_address as `0x${string}`, BigInt(r.batch_id), amount);
        };
        const onRedeem = () => {
          setBusy(key);
          redeem(r.token_address as `0x${string}`, BigInt(r.batch_id), amount);
        };

        return (
          <div key={key} className="card p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold">{symbol}</span>
                <span className="text-[11px] text-slate-500 font-mono">batch #{r.batch_id}</span>
                <StatusPill status={r.status} />
              </div>
              <div className="text-[11px] text-slate-500 font-mono truncate">
                {r.token_address}
              </div>
              <div className="text-sm text-slate-300 mt-2">
                Receipts: <span className="font-mono">{formatUnits(amount, decimals)}</span>
              </div>
              {isClaimable && expectedPayout > 0n && (
                <div className="text-[11px] text-emerald-400 mt-0.5">
                  Claimable: ~{formatEther(expectedPayout)} BNB
                </div>
              )}
            </div>

            <div className="shrink-0">
              {isClaimable ? (
                <button
                  onClick={onClaim}
                  disabled={claimPending && busy === key}
                  className="btn-primary"
                >
                  {claimPending && busy === key ? "Claiming…" : "Claim BNB"}
                </button>
              ) : isRedeemable ? (
                <button
                  onClick={onRedeem}
                  disabled={redeemPending && busy === key}
                  className="btn-ghost"
                >
                  {redeemPending && busy === key ? "Redeeming…" : "Redeem dust"}
                </button>
              ) : r.status === "OPEN" ? (
                <span className="text-xs text-slate-500">Awaiting execution</span>
              ) : (
                <span className="text-xs text-slate-500">Empty</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({ status }: { status: "OPEN" | "EXECUTED" | "FAILED" }) {
  const cls =
    status === "EXECUTED"
      ? "pill-green"
      : status === "FAILED"
        ? "pill-yellow"
        : "pill-slate";
  return <span className={cls}>{status}</span>;
}
