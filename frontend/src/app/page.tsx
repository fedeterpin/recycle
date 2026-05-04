import Link from "next/link";

const modules = [
  {
    href: "/incinerator",
    title: "Incinerator",
    emoji: "🔥",
    description: "Burn worthless tokens. Get $RCY rewards and an on-chain Loss Certificate NFT.",
    status: "Live",
  },
  {
    href: "/compactor",
    title: "Compactor",
    emoji: "🗜️",
    description:
      "Pool dust into a per-token batch. Multisig swaps it for BNB. Burn your receipt to claim pro-rata.",
    status: "Live",
  },
  {
    href: "#",
    title: "Refinery",
    emoji: "⚗️",
    description: "Auto-route stuck tokens through best available exit liquidity.",
    status: "Soon",
  },
];

export default function Home() {
  return (
    <div className="max-w-5xl mx-auto px-2 animate-fade-in">
      <header className="text-center pt-16 pb-12">
        <span className="pill-green mb-6">v1 · BSC Testnet</span>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-4">
          The on-chain refinery for{" "}
          <span className="bg-gradient-to-r from-emerald-400 to-sky-400 bg-clip-text text-transparent">
            crypto trash
          </span>
        </h1>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
          Burn dead memecoins, scams and dust. Earn $RCY from a fixed reward pool.
          Walk away with a tax loss certificate the IRS-Bot would actually accept.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-3">
        {modules.map((m) => {
          const disabled = m.status === "Soon";
          const cls = `card p-6 group relative transition-all duration-200 ${
            disabled
              ? "opacity-60 cursor-not-allowed"
              : "hover:border-brand-green/60 hover:-translate-y-0.5 hover:shadow-emerald-500/10"
          }`;
          const content = (
            <>
              <div className="flex items-start justify-between mb-4">
                <div className="text-4xl">{m.emoji}</div>
                <span className={disabled ? "pill-slate" : "pill-green"}>{m.status}</span>
              </div>
              <h2 className="text-xl font-semibold mb-1.5">{m.title}</h2>
              <p className="text-slate-400 text-sm leading-relaxed">{m.description}</p>
            </>
          );
          return disabled ? (
            <div key={m.title} className={cls}>{content}</div>
          ) : (
            <Link key={m.title} href={m.href} className={cls}>{content}</Link>
          );
        })}
      </div>

      <footer className="mt-20 pb-10 text-center text-xs text-slate-500">
        Built for testing · Local deploys use a MockPriceOracle ($1/token)
      </footer>
    </div>
  );
}
