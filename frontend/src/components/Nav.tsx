import Link from "next/link";
import { ConnectButton } from "./ConnectButton";

export function Nav() {
  return (
    <nav className="sticky top-0 z-30 backdrop-blur-md bg-brand-dark/70 border-b border-slate-800/80">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="flex items-center gap-2 px-2 py-1 rounded-lg text-brand-green font-bold tracking-tight"
          >
            <span className="text-xl">♻️</span>
            <span>Recycle</span>
          </Link>
          <Link
            href="/incinerator"
            className="ml-4 text-slate-300 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800/60 transition-colors"
          >
            Incinerator
          </Link>
          <Link
            href="/stats"
            className="text-slate-300 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800/60 transition-colors"
          >
            Stats
          </Link>
          <Link
            href="/transactions"
            className="text-slate-300 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800/60 transition-colors"
          >
            Transactions
          </Link>
        </div>
        <ConnectButton />
      </div>
    </nav>
  );
}
