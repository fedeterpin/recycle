import { ethers } from "ethers";
import { getProvider } from "./provider";
import { config } from "../config";
import { insertBurn, getLastIndexedBlock, BurnRecord } from "../db/supabase";
import { generateCertificate } from "../pdf/certificateGenerator";
import { getTokenMetadata } from "./tokenMetadata";
import { putCertificate } from "../storage/certificates";
import IncineratorABI from "./abis/Incinerator.json";

const RECONNECT_DELAY_MS = 5_000;
const BACKFILL_CHUNK = 5_000; // BSC RPCs cap eth_getLogs at 5k blocks

export async function startIncineratorListener(): Promise<void> {
  console.log("[Indexer] Starting Incinerator event listener...");
  await connect();
}

async function connect(): Promise<void> {
  try {
    const provider = getProvider();
    const contract = new ethers.Contract(config.incineratorAddress, IncineratorABI, provider);

    const currentBlock = await provider.getBlockNumber();
    const lastIndexed = await getLastIndexedBlock();
    const fromBlock = lastIndexed != null ? lastIndexed + 1 : currentBlock;

    if (fromBlock < currentBlock) {
      console.log(`[Indexer] Backfilling LogBurn from block ${fromBlock} to ${currentBlock}`);
      await backfill(contract, provider, fromBlock, currentBlock);
    }

    contract.on(
      "LogBurn",
      async (
        user: string,
        token: string,
        amount: bigint,
        usdValue: bigint,
        rcyRewarded: bigint,
        certificateId: bigint,
        // ethers v6 passes a ContractEventPayload here, not an EventLog directly.
        // The actual log (with transactionHash, blockNumber) lives at payload.log.
        payload: ethers.ContractEventPayload,
      ) => {
        try {
          await handleBurn(provider, {
            user, token, amount, usdValue, rcyRewarded, certificateId,
            event: payload.log,
          });
        } catch (err) {
          // Don't let a single failure tear down the whole listener process.
          console.error("[Indexer] Failed to handle LogBurn:", err);
        }
      },
    );

    console.log(`[Indexer] Listening for LogBurn events on ${config.incineratorAddress}`);
  } catch (err) {
    console.error("[Indexer] Connection error:", err);
    await reconnect();
  }
}

async function backfill(
  contract: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  fromBlock: number,
  toBlock: number,
): Promise<void> {
  const filter = contract.filters.LogBurn();

  for (let start = fromBlock; start <= toBlock; start += BACKFILL_CHUNK) {
    const end = Math.min(start + BACKFILL_CHUNK - 1, toBlock);
    const logs = await contract.queryFilter(filter, start, end);

    for (const log of logs) {
      const ev = log as ethers.EventLog;
      const [user, token, amount, usdValue, rcyRewarded, certificateId] = ev.args as unknown as [
        string, string, bigint, bigint, bigint, bigint,
      ];
      await handleBurn(provider, {
        user, token, amount, usdValue, rcyRewarded, certificateId, event: ev,
      });
    }
  }
}

interface BurnEvent {
  user: string;
  token: string;
  amount: bigint;
  usdValue: bigint;
  rcyRewarded: bigint;
  certificateId: bigint;
  event: ethers.EventLog;
}

async function handleBurn(provider: ethers.JsonRpcProvider, e: BurnEvent): Promise<void> {
  const txHash = e.event.transactionHash;
  const blockNumber = e.event.blockNumber;
  const block = await provider.getBlock(blockNumber);
  const timestamp = block ? new Date(block.timestamp * 1000).toISOString() : new Date().toISOString();

  console.log(`[Indexer] LogBurn: user=${e.user} token=${e.token} amount=${e.amount} tx=${txHash}`);

  const record: BurnRecord = {
    tx_hash: txHash,
    user_address: e.user.toLowerCase(),
    token_address: e.token.toLowerCase(),
    amount: e.amount.toString(),
    usd_value: e.usdValue.toString(),
    rcy_rewarded: e.rcyRewarded.toString(),
    certificate_id: e.certificateId.toString(),
    block_number: blockNumber,
    burned_at: timestamp,
  };

  await insertBurn(record);

  // Generate and cache the PDF certificate (fire and forget — not critical path)
  (async () => {
    const meta = await getTokenMetadata(provider, e.token);
    const pdf = await generateCertificate({
      ...record,
      txHash,
      token_symbol: meta.symbol,
      token_decimals: meta.decimals,
    });
    await putCertificate(txHash, pdf);
  })().catch((err) => console.error("[Indexer] Certificate generation failed:", err));
}

async function reconnect(): Promise<void> {
  console.log(`[Indexer] Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
  await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
  await connect();
}
