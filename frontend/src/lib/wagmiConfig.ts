import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { bsc, bscTestnet, defineChain } from "@reown/appkit/networks";

const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID;
if (!projectId) throw new Error("Missing NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID");

/// Hardhat local network — used when NEXT_PUBLIC_CHAIN_ID=31337.
/// Reown's @reown/appkit/networks doesn't ship a hardhat preset, so we define
/// it locally with the same shape the adapter expects.
const hardhat = defineChain({
  id: 31337,
  caipNetworkId: "eip155:31337",
  chainNamespace: "eip155",
  name: "Hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
  testnet: true,
});

/// All networks the app supports. AppKit lets the user switch between them
/// from the modal, even if only one is "active" by env. Keeping all three
/// avoids needing rebuilds when targeting a different chain.
export const networks = [hardhat, bscTestnet, bsc] as const;

const wagmiAdapter = new WagmiAdapter({
  networks: networks as unknown as [typeof networks[number], ...typeof networks[number][]],
  projectId,
  ssr: true,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

createAppKit({
  adapters: [wagmiAdapter],
  networks: networks as unknown as [typeof networks[number], ...typeof networks[number][]],
  projectId,
  metadata: {
    name: "Recycle Protocol",
    description: "Turn your crypto trash into treasure",
    url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
    icons: [],
  },
  features: {
    analytics: false,
    email: false,
    socials: [],
  },
});

export { projectId };
