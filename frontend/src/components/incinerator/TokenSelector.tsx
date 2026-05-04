"use client";

import { useState } from "react";
import { formatUnits, isAddress, type Address } from "viem";
import { useWalletTokens, WalletToken } from "@/hooks/useWalletTokens";

interface Props {
  owner: Address | undefined;
  selected: string;
  onSelect: (address: string) => void;
}

/// @notice Token picker. On local Hardhat, lists tokens detected in the wallet
///         by scanning Transfer logs. On other chains, falls back to a manual
///         address input — most production chains need an off-chain indexer
///         to enumerate ERC-20 holdings, which is out of scope for v1.
export function TokenSelector({ owner, selected, onSelect }: Props) {
  const { tokens, loading, unsupported, refetch } = useWalletTokens(owner);
  const [manual, setManual] = useState(false);

  if (unsupported || manual) {
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="label !mb-0">Token address</span>
          {!unsupported && (
            <button
              onClick={() => { setManual(false); onSelect(""); }}
              className="text-[11px] text-brand-green hover:underline"
            >
              ← Pick from wallet
            </button>
          )}
        </div>
        <input
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder="0x…"
          value={selected}
          onChange={(e) => onSelect(e.target.value.trim())}
          className="input-mono"
        />
        {unsupported && (
          <p className="text-[11px] text-slate-500 mt-1.5">
            Auto-discovery is only available on local Hardhat. On BSC, paste the token address manually.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="label !mb-0">Pick a token from your wallet</span>
        <div className="flex items-center gap-3">
          <button
            onClick={refetch}
            className="text-[11px] text-slate-400 hover:text-slate-200"
            title="Re-scan"
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => setManual(true)}
            className="text-[11px] text-brand-green hover:underline"
          >
            Enter address manually →
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-6 text-sm text-slate-400 flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
          Scanning your wallet for tokens…
        </div>
      ) : tokens.length === 0 ? (
        <div className="card p-6 text-center">
          <div className="text-2xl mb-1">🪙</div>
          <p className="text-sm text-slate-300 mb-1">No ERC-20 tokens detected</p>
          <p className="text-xs text-slate-500">
            Mint or transfer some tokens to this wallet, then hit Refresh.
          </p>
        </div>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {tokens.map((t) => (
            <TokenRow
              key={t.address}
              token={t}
              isSelected={isAddress(selected) && selected.toLowerCase() === t.address.toLowerCase()}
              onClick={() => onSelect(t.address)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TokenRow({
  token, isSelected, onClick,
}: { token: WalletToken; isSelected: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition-all
          ${isSelected
            ? "bg-emerald-500/10 border-brand-green/60 shadow-lg shadow-emerald-500/10"
            : "bg-slate-900/40 border-slate-800 hover:border-slate-600 hover:bg-slate-800/40"}
        `}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{token.symbol}</span>
            {isSelected && <span className="text-brand-green text-xs">✓ selected</span>}
          </div>
          <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
            {token.address}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-sm">
            {formatUnits(token.balance, token.decimals)}
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">
            balance
          </div>
        </div>
      </button>
    </li>
  );
}
