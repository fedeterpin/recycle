"use client";

import { useState } from "react";
import { explorerUrl } from "@/lib/contracts";

interface Props {
  label: string;
  address: string;
  description?: string;
}

export function AddressRow({ label, address, description }: Props) {
  const [copied, setCopied] = useState(false);
  const link = explorerUrl(address, "address");

  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-slate-800/60 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white">{label}</div>
        {description && <div className="text-xs text-slate-500">{description}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <code className="text-xs font-mono text-slate-400 bg-slate-900/60 px-2 py-1 rounded-md">
          {address.slice(0, 6)}…{address.slice(-4)}
        </code>
        <button
          onClick={copy}
          className="text-xs text-slate-500 hover:text-brand-green transition-colors px-2 py-1 rounded-md hover:bg-slate-800/60"
          title="Copy address"
        >
          {copied ? "✓" : "⧉"}
        </button>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-500 hover:text-brand-green transition-colors px-2 py-1 rounded-md hover:bg-slate-800/60"
            title="View on explorer"
          >
            ↗
          </a>
        )}
      </div>
    </div>
  );
}
