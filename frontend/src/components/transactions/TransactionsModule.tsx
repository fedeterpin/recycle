"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useBurnHistory } from "@/hooks/useBurnHistory";
import { BurnRow } from "./BurnRow";

type View = "all" | "mine";

export function TransactionsModule() {
  const { address, isConnected } = useAccount();
  const [view, setView] = useState<View>("all");

  const { events, loading, error } = useBurnHistory(
    view === "mine" && address ? { user: address } : undefined
  );

  return (
    <div className="max-w-6xl mx-auto px-2 animate-fade-in pb-16">
      <header className="mt-6 mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Transactions</h1>
          <p className="text-slate-400 text-sm">
            All burns recorded on-chain by the Incinerator. Read directly from{" "}
            <code className="text-brand-green">LogBurn</code> events — no backend.
          </p>
        </div>
        <div className="inline-flex rounded-xl bg-slate-900/60 border border-slate-800 p-1 text-sm">
          <button
            onClick={() => setView("all")}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              view === "all" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setView("mine")}
            disabled={!isConnected}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              view === "mine" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            }`}
          >
            Mine
          </button>
        </div>
      </header>

      {loading && (
        <div className="card p-12 text-center text-slate-400 text-sm">Loading on-chain events…</div>
      )}

      {error && (
        <div className="card p-6 border-red-500/40 bg-red-500/5 text-sm text-red-200">
          <strong className="text-red-300">Error fetching events:</strong> {error}
        </div>
      )}

      {!loading && !error && events && events.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">🪹</div>
          <h2 className="text-lg font-semibold mb-1">No burns yet</h2>
          <p className="text-slate-400 text-sm">
            {view === "mine"
              ? "You haven't burned any tokens yet. Head to the Incinerator to make your first burn."
              : "No one has burned anything yet. Be the first."}
          </p>
        </div>
      )}

      {!loading && !error && events && events.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/40">
                  <Th>When</Th>
                  <Th>User</Th>
                  <Th>Burned</Th>
                  <Th>USD value</Th>
                  <Th>RCY received</Th>
                  <Th>Rate</Th>
                  <Th>TX</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <BurnRow key={e.txHash + "_" + e.certificateId.toString()} event={e} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-slate-800 text-xs text-slate-500 flex justify-between">
            <span>{events.length} {events.length === 1 ? "burn" : "burns"} indexed</span>
            <span>"Rate" = RCY received per $1 of USD value at burn time</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left py-2.5 px-3 text-[11px] uppercase tracking-wider text-slate-500 font-medium">
      {children}
    </th>
  );
}
