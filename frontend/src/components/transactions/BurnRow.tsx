"use client";

import { useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { ERC20_ABI } from "@/lib/abis/erc20";
import { explorerUrl } from "@/lib/contracts";
import type { BurnEvent } from "@/hooks/useBurnHistory";

interface Props {
  event: BurnEvent;
}

export function BurnRow({ event }: Props) {
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
        {txLink ? (
          <a href={txLink} target="_blank" rel="noreferrer" className="text-brand-green hover:underline font-mono">
            {event.txHash.slice(0, 8)}↗
          </a>
        ) : (
          <span className="text-slate-500 font-mono">{event.txHash.slice(0, 10)}…</span>
        )}
      </td>
    </tr>
  );
}

function Address({ value, link, muted = false }: { value: string; link: string | null; muted?: boolean }) {
  const short = `${value.slice(0, 6)}…${value.slice(-4)}`;
  const cls = muted ? "text-slate-500" : "text-slate-300";
  if (link) {
    return (
      <a href={link} target="_blank" rel="noreferrer" className={`${cls} hover:text-brand-green font-mono`}>
        {short}
      </a>
    );
  }
  return <span className={`${cls} font-mono`}>{short}</span>;
}

function trimNumber(s: string, maxDecimals: number): string {
  const [int, frac] = s.split(".");
  if (!frac) return int;
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed ? `${int}.${trimmed}` : int;
}
