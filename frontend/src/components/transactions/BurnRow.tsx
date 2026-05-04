"use client";

import { useState } from "react";
import { useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { ERC20_ABI } from "@/lib/abis/erc20";
import { explorerUrl } from "@/lib/contracts";
import type { BurnEvent } from "@/hooks/useBurnHistory";

interface Props {
  event: BurnEvent;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export function BurnRow({ event }: Props) {
  const [copied, setCopied] = useState(false);

  const copyTxHash = async () => {
    await navigator.clipboard.writeText(event.txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const { data } = useReadContracts({
    contracts: [
      { address: event.token, abi: ERC20_ABI, functionName: "symbol" },
      { address: event.token, abi: ERC20_ABI, functionName: "decimals" },
    ],
    query: { staleTime: 60_000 },
  });

  const symbol   = (data?.[0]?.result as string | undefined) ?? "—";
  const decimals = (data?.[1]?.result as number | undefined) ?? 18;

  const amountFormatted   = trimNumber(formatUnits(event.amount, decimals), 4);
  const usdFormatted      = trimNumber(formatUnits(event.usdValue, 18), 6);
  const rcyFormatted      = trimNumber(formatUnits(event.rcyRewarded, 18), 4);

  // "Exchange rate" = RCY received per $1 of USD value burned
  const rate = event.usdValue > 0n
    ? Number(event.rcyRewarded) / Number(event.usdValue)
    : null;

  const txLink = explorerUrl(event.txHash, "tx");
  const tokenLink = explorerUrl(event.token, "address");
  const userLink = explorerUrl(event.user, "address");

  const dt = event.timestamp ? new Date(event.timestamp * 1000) : null;

  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-900/40 transition-colors">
      <td className="py-3 px-3 text-xs text-slate-400 whitespace-nowrap">
        {dt ? dt.toLocaleString() : `#${event.blockNumber}`}
      </td>

      <td className="py-3 px-3 text-xs">
        <Address value={event.user} link={userLink} />
      </td>

      <td className="py-3 px-3 text-xs">
        <div className="font-medium text-white">{amountFormatted} {symbol}</div>
        <Address value={event.token} link={tokenLink} muted />
      </td>

      <td className="py-3 px-3 text-xs text-slate-300 tabular-nums">
        {event.usdValue === 0n ? <span className="text-slate-500">no price</span> : `$${usdFormatted}`}
      </td>

      <td className="py-3 px-3 text-xs tabular-nums text-emerald-300 font-medium">
        +{rcyFormatted} RCY
      </td>

      <td className="py-3 px-3 text-xs text-slate-400 tabular-nums">
        {rate != null ? `${trimNumber(rate.toString(), 3)} RCY / $` : "—"}
      </td>

      <td className="py-3 px-3 text-xs">
        <div className="inline-flex items-center gap-1.5">
          {txLink ? (
            <a
              href={txLink}
              target="_blank"
              rel="noreferrer"
              className="text-brand-green hover:underline font-mono"
              title={event.txHash}
            >
              {event.txHash.slice(0, 8)}↗
            </a>
          ) : (
            <span className="text-slate-400 font-mono" title={event.txHash}>
              {event.txHash.slice(0, 10)}…
            </span>
          )}
          <button
            onClick={copyTxHash}
            className="text-slate-500 hover:text-brand-green transition-colors px-1 rounded"
            title={copied ? "Copied!" : "Copy tx hash"}
          >
            {copied ? "✓" : "⧉"}
          </button>
        </div>
      </td>

      <td className="py-3 px-3 text-xs">
        {API_URL ? (
          <a
            href={`${API_URL}/certificates/${event.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800/60 hover:bg-slate-700/80 text-slate-300 hover:text-white transition-colors"
            title="Download Loss Certificate PDF"
          >
            ↓ PDF
          </a>
        ) : (
          <span className="text-slate-600 text-[11px]">—</span>
        )}
      </td>
    </tr>
  );
}

function Address({ value, link, muted = false }: { value: string; link: string | null; muted?: boolean }) {
  const [copied, setCopied] = useState(false);
  const short = `${value.slice(0, 6)}…${value.slice(-4)}`;
  const cls = muted ? "text-slate-500" : "text-slate-300";

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span className="inline-flex items-center gap-1">
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className={`${cls} hover:text-brand-green font-mono`}
          title={value}
        >
          {short}
        </a>
      ) : (
        <span className={`${cls} font-mono`} title={value}>{short}</span>
      )}
      <button
        onClick={copy}
        className="text-slate-600 hover:text-brand-green transition-colors px-0.5 rounded text-[11px]"
        title={copied ? "Copied!" : "Copy address"}
      >
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}

function trimNumber(s: string, maxDecimals: number): string {
  const [int, frac] = s.split(".");
  if (!frac) return int;
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed ? `${int}.${trimmed}` : int;
}
