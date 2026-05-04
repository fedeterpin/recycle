import { createConfig, http } from "wagmi";
import { bsc, bscTestnet, hardhat } from "wagmi/chains";

const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID!;
const chainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || "56", 10);

const chain = chainId === 97 ? bscTestnet : chainId === 31337 ? hardhat : bsc;

export const wagmiConfig = createConfig({
  chains: [chain],
  transports: {
    [bsc.id]:        http("https://bsc-dataseed1.binance.org/"),
    [bscTestnet.id]: http("https://data-seed-prebsc-1-s1.binance.org:8545/"),
    [hardhat.id]:    http("http://127.0.0.1:8545"),
  },
  ssr: true,
});

export { projectId };
