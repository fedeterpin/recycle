"use client";

import { useReadContracts } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { CONTRACTS } from "@/lib/contracts";
import { StatCard } from "./StatCard";
import { AddressRow } from "./AddressRow";
import { SplitsBar } from "./SplitsBar";

const BIG_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DEC_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

function bigNumber(v: bigint, decimals = 18): string {
  const asNumber = Number(formatUnits(v, decimals));
  if (asNumber >= 1_000_000) return BIG_FORMATTER.format(asNumber);
  return DEC_FORMATTER.format(asNumber);
}

export function StatsModule() {
  // Single multicall — wagmi batches all of these into one RPC call.
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      // Token + supply
      { ...CONTRACTS.rcy,         functionName: "totalSupply" },
      { ...CONTRACTS.rcy,         functionName: "balanceOf",   args: [CONTRACTS.incinerator.address] },
      { ...CONTRACTS.rcy,         functionName: "balanceOf",   args: [CONTRACTS.vesting.address] },

      // Incinerator params
      { ...CONTRACTS.incinerator, functionName: "flatFee" },
      { ...CONTRACTS.incinerator, functionName: "minReward" },
      { ...CONTRACTS.incinerator, functionName: "rewardK" },
      { ...CONTRACTS.incinerator, functionName: "treasury" },

      // PoolManager splits
      { ...CONTRACTS.poolManager, functionName: "buybackBps" },
      { ...CONTRACTS.poolManager, functionName: "holdersBps" },
      { ...CONTRACTS.poolManager, functionName: "devBps" },
      { ...CONTRACTS.poolManager, functionName: "marketingBps" },

      // BuybackBurner
      { ...CONTRACTS.buyback,     functionName: "totalBurned" },

      // Vesting
      { ...CONTRACTS.vesting,     functionName: "unlockedMilestones" },
      { ...CONTRACTS.vesting,     functionName: "getBeneficiaries" },

      // Certificates
      { ...CONTRACTS.certificate, functionName: "nextTokenId" },
    ],
    query: { refetchInterval: 8_000 },
  });

  const get = <T,>(i: number): T | undefined => data?.[i]?.result as T | undefined;

  const totalSupply       = get<bigint>(0);
  const incPoolBalance    = get<bigint>(1);
  const vestingLocked     = get<bigint>(2);
  const flatFee           = get<bigint>(3);
  const minReward         = get<bigint>(4);
  const rewardK           = get<bigint>(5);
  const treasury          = get<string>(6);
  const buybackBps        = get<bigint>(7);
  const holdersBps        = get<bigint>(8);
  const devBps            = get<bigint>(9);
  const marketingBps      = get<bigint>(10);
  const totalBurned       = get<bigint>(11);
  const unlockedMilestones= get<bigint>(12);
  const beneficiaries     = get<string[]>(13);
  const nextTokenId       = get<bigint>(14);

  const burnsProcessed = nextTokenId != null ? nextTokenId - 1n : undefined;

  return (
    <div className="max-w-5xl mx-auto px-2 animate-fade-in pb-16">
      <header className="mt-6 mb-8 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Protocol Stats</h1>
          <p className="text-slate-400 text-sm">
            All values read directly from on-chain state. Refreshes every 8 seconds.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="btn-ghost text-sm"
          disabled={isLoading}
        >
          {isLoading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <section className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-10">
        <StatCard
          label="Rewards Pool"
          value={incPoolBalance != null ? bigNumber(incPoolBalance) : "—"}
          unit="RCY"
          hint="Available for future burn rewards"
          tone="green"
        />
        <StatCard
          label="Burns Processed"
          value={burnsProcessed != null ? burnsProcessed.toString() : "—"}
          hint="Total Loss Certificates minted"
          tone="blue"
        />
        <StatCard
          label="RCY Burned"
          value={totalBurned != null ? bigNumber(totalBurned) : "—"}
          unit="RCY"
          hint="Permanently removed via Buyback & Burn"
          tone="red"
        />
        <StatCard
          label="Total Supply"
          value={totalSupply != null ? bigNumber(totalSupply) : "—"}
          unit="RCY"
          hint="Fixed at deploy — no further mint possible"
        />
      </section>

      {/* ── Token & Distribution ──────────────────────────────────────────── */}
      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">$RCY Token</h2>
        <div className="grid gap-3 md:grid-cols-3 mb-5">
          <Metric
            label="Circulating estimate"
            value={
              totalSupply != null && vestingLocked != null && incPoolBalance != null && totalBurned != null
                ? bigNumber(totalSupply - vestingLocked - incPoolBalance - totalBurned)
                : "—"
            }
            unit="RCY"
          />
          <Metric
            label="Locked in vesting"
            value={vestingLocked != null ? bigNumber(vestingLocked) : "—"}
            unit="RCY"
          />
          <Metric
            label="Burned (deflation)"
            value={totalBurned != null ? bigNumber(totalBurned) : "—"}
            unit="RCY"
          />
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Distribution at deploy: 34% rewards pool · 20% presale · 15% team (vesting) ·
          12% marketing · 11% DEX liquidity · 8% protocol reserve. The only path to
          reduce supply is via the Buyback &amp; Burn mechanism.
        </p>
      </section>

      {/* ── Incinerator ───────────────────────────────────────────────────── */}
      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Incinerator</h2>
        <div className="grid gap-3 md:grid-cols-2 mb-5">
          <Metric
            label="Flat fee per burn"
            value={flatFee != null ? formatEther(flatFee) : "—"}
            unit="BNB"
          />
          <Metric
            label="Min reward (no-price tokens)"
            value={minReward != null ? bigNumber(minReward) : "—"}
            unit="RCY"
          />
          <Metric
            label="Reward k (sqrt scaling)"
            value={rewardK != null ? bigNumber(rewardK) : "—"}
            unit="RCY"
          />
          <Metric
            label="Reward formula"
            value="minReward + k × √usdValue"
            mono
          />
        </div>
        <AddressRow label="Treasury (BNB fees)" address={treasury || "—"} />
        <AddressRow label="Incinerator contract" address={CONTRACTS.incinerator.address} />
      </section>

      {/* ── Pool Manager ──────────────────────────────────────────────────── */}
      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Pool Manager — BNB distribution</h2>
        {buybackBps != null && holdersBps != null && devBps != null && marketingBps != null ? (
          <SplitsBar
            segments={[
              { label: "Buyback & Burn", bps: Number(buybackBps),   color: "#34d399" },
              { label: "Holders",        bps: Number(holdersBps),   color: "#38bdf8" },
              { label: "Dev",            bps: Number(devBps),       color: "#fbbf24" },
              { label: "Marketing",      bps: Number(marketingBps), color: "#f472b6" },
            ]}
          />
        ) : (
          <div className="text-slate-500 text-sm">Loading splits…</div>
        )}
        <p className="text-xs text-slate-500 mt-4 leading-relaxed">
          When the multisig sells a vault position, the resulting BNB is split
          according to these basis points (must always sum to 10,000).
        </p>
        <div className="mt-4">
          <AddressRow label="PoolManager contract" address={CONTRACTS.poolManager.address} />
          <AddressRow label="Vault (token custody)" address={CONTRACTS.vault.address} />
          <AddressRow label="BuybackBurner"        address={CONTRACTS.buyback.address} />
        </div>
      </section>

      {/* ── Vesting ───────────────────────────────────────────────────────── */}
      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Team Vesting</h2>
        <div className="grid gap-3 md:grid-cols-3 mb-5">
          <Metric
            label="Locked"
            value={vestingLocked != null ? bigNumber(vestingLocked) : "—"}
            unit="RCY"
          />
          <Metric
            label="Milestones unlocked"
            value={unlockedMilestones != null ? `${unlockedMilestones} / 4` : "—"}
          />
          <Metric
            label="Beneficiaries"
            value={beneficiaries != null ? beneficiaries.length.toString() : "—"}
          />
        </div>
        <p className="text-xs text-slate-500 leading-relaxed mb-4">
          Each milestone unlocks 25% of every beneficiary&apos;s allocation. Milestones
          require multisig confirmation and are tied to public, verifiable metrics.
        </p>
        <AddressRow label="MilestoneVesting contract" address={CONTRACTS.vesting.address} />
      </section>

      {/* ── Certificates ──────────────────────────────────────────────────── */}
      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Tax Loss Certificates</h2>
        <div className="grid gap-3 md:grid-cols-2 mb-5">
          <Metric
            label="Total minted"
            value={burnsProcessed != null ? burnsProcessed.toString() : "—"}
          />
          <Metric label="Standard" value="ERC-721 · on-chain metadata" mono />
        </div>
        <AddressRow label="TaxLossCertificate contract" address={CONTRACTS.certificate.address} />
      </section>

      <p className="text-center text-xs text-slate-600">
        Anyone can verify these values directly on-chain at any time.
      </p>
    </div>
  );
}

function Metric({
  label, value, unit, mono,
}: { label: string; value: string; unit?: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-base text-slate-100 ${mono ? "font-mono text-sm" : "font-semibold tabular-nums"}`}>
          {value}
        </span>
        {unit && <span className="text-xs text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}
