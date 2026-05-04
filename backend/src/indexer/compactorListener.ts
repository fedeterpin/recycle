import { ethers } from "ethers";
import { getProvider } from "./provider";
import { config } from "../config";
import {
  bumpBatchTotals,
  ensureBatch,
  markBatchFailed,
  upsertBatch,
  upsertClaim,
  upsertDeposit,
  getLastIndexedCompactorBlock,
} from "../db/compactor";
import CompactorABI from "./abis/Compactor.json";

const RECONNECT_DELAY_MS = 5_000;
const BACKFILL_CHUNK = 5_000;

export async function startCompactorListener(): Promise<void> {
  console.log("[Compactor Indexer] Starting Compactor event listener...");
  await connect();
}

async function connect(): Promise<void> {
  try {
    const provider = getProvider();
    const contract = new ethers.Contract(config.compactorAddress, CompactorABI, provider);

    const currentBlock = await provider.getBlockNumber();
    const lastIndexed = await getLastIndexedCompactorBlock();
    const fromBlock = lastIndexed != null ? lastIndexed + 1 : currentBlock;

    if (fromBlock < currentBlock) {
      console.log(
        `[Compactor Indexer] Backfilling events from block ${fromBlock} to ${currentBlock}`,
      );
      await backfill(contract, provider, fromBlock, currentBlock);
    }

    contract.on(
      "DustDeposited",
      async (
        user: string,
        token: string,
        batchId: bigint,
        amount: bigint,
        receiptTokenId: bigint,
        payload: ethers.ContractEventPayload,
      ) => {
        try {
          await handleDeposit(provider, { user, token, batchId, amount, receiptTokenId, event: payload.log });
        } catch (err) {
          console.error("[Compactor Indexer] DustDeposited handler failed:", err);
        }
      },
    );

    contract.on(
      "BatchExecuted",
      async (
        token: string,
        batchId: bigint,
        totalIn: bigint,
        bnbReceived: bigint,
        protocolFee: bigint,
        bnbForUsers: bigint,
        payload: ethers.ContractEventPayload,
      ) => {
        try {
          await handleExecuted(provider, { token, batchId, totalIn, bnbReceived, protocolFee, bnbForUsers, event: payload.log });
        } catch (err) {
          console.error("[Compactor Indexer] BatchExecuted handler failed:", err);
        }
      },
    );

    contract.on(
      "BatchFailed",
      async (
        token: string,
        batchId: bigint,
        payload: ethers.ContractEventPayload,
      ) => {
        try {
          await handleFailed(provider, { token, batchId, event: payload.log });
        } catch (err) {
          console.error("[Compactor Indexer] BatchFailed handler failed:", err);
        }
      },
    );

    contract.on(
      "BnbClaimed",
      async (
        user: string,
        token: string,
        batchId: bigint,
        receiptAmount: bigint,
        bnbAmount: bigint,
        payload: ethers.ContractEventPayload,
      ) => {
        try {
          await handleClaim(provider, "BNB", { user, token, batchId, receiptAmount, payout: bnbAmount, event: payload.log });
        } catch (err) {
          console.error("[Compactor Indexer] BnbClaimed handler failed:", err);
        }
      },
    );

    contract.on(
      "DustRedeemed",
      async (
        user: string,
        token: string,
        batchId: bigint,
        receiptAmount: bigint,
        tokenAmount: bigint,
        payload: ethers.ContractEventPayload,
      ) => {
        try {
          await handleClaim(provider, "DUST", { user, token, batchId, receiptAmount, payout: tokenAmount, event: payload.log });
        } catch (err) {
          console.error("[Compactor Indexer] DustRedeemed handler failed:", err);
        }
      },
    );

    console.log(
      `[Compactor Indexer] Listening for events on ${config.compactorAddress}`,
    );
  } catch (err) {
    console.error("[Compactor Indexer] Connection error:", err);
    await reconnect();
  }
}

async function backfill(
  contract: ethers.Contract,
  provider: ethers.Provider,
  fromBlock: number,
  toBlock: number,
): Promise<void> {
  for (let start = fromBlock; start <= toBlock; start += BACKFILL_CHUNK) {
    const end = Math.min(start + BACKFILL_CHUNK - 1, toBlock);

    for (const log of (await contract.queryFilter(contract.filters.DustDeposited(), start, end)) as ethers.EventLog[]) {
      const [user, token, batchId, amount, receiptTokenId] = log.args as unknown as [string, string, bigint, bigint, bigint];
      await handleDeposit(provider, { user, token, batchId, amount, receiptTokenId, event: log });
    }
    for (const log of (await contract.queryFilter(contract.filters.BatchExecuted(), start, end)) as ethers.EventLog[]) {
      const [token, batchId, totalIn, bnbReceived, protocolFee, bnbForUsers] = log.args as unknown as [string, bigint, bigint, bigint, bigint, bigint];
      await handleExecuted(provider, { token, batchId, totalIn, bnbReceived, protocolFee, bnbForUsers, event: log });
    }
    for (const log of (await contract.queryFilter(contract.filters.BatchFailed(), start, end)) as ethers.EventLog[]) {
      const [token, batchId] = log.args as unknown as [string, bigint];
      await handleFailed(provider, { token, batchId, event: log });
    }
    for (const log of (await contract.queryFilter(contract.filters.BnbClaimed(), start, end)) as ethers.EventLog[]) {
      const [user, token, batchId, receiptAmount, bnbAmount] = log.args as unknown as [string, string, bigint, bigint, bigint];
      await handleClaim(provider, "BNB", { user, token, batchId, receiptAmount, payout: bnbAmount, event: log });
    }
    for (const log of (await contract.queryFilter(contract.filters.DustRedeemed(), start, end)) as ethers.EventLog[]) {
      const [user, token, batchId, receiptAmount, tokenAmount] = log.args as unknown as [string, string, bigint, bigint, bigint];
      await handleClaim(provider, "DUST", { user, token, batchId, receiptAmount, payout: tokenAmount, event: log });
    }
  }
}

async function timestampOf(provider: ethers.Provider, blockNumber: number): Promise<string> {
  const block = await provider.getBlock(blockNumber);
  return block ? new Date(block.timestamp * 1000).toISOString() : new Date().toISOString();
}

async function handleDeposit(
  provider: ethers.Provider,
  e: { user: string; token: string; batchId: bigint; amount: bigint; receiptTokenId: bigint; event: ethers.EventLog },
): Promise<void> {
  const ts = await timestampOf(provider, e.event.blockNumber);
  console.log(
    `[Compactor Indexer] DustDeposited: user=${e.user} token=${e.token} batch=${e.batchId} amount=${e.amount}`,
  );

  await ensureBatch(e.token, Number(e.batchId));
  await upsertDeposit({
    tx_hash: e.event.transactionHash,
    user_address: e.user.toLowerCase(),
    token_address: e.token.toLowerCase(),
    batch_id: Number(e.batchId),
    amount: e.amount.toString(),
    receipt_token_id: e.receiptTokenId.toString(),
    block_number: e.event.blockNumber,
    deposited_at: ts,
  });
  await bumpBatchTotals(e.token, Number(e.batchId), e.amount);
}

async function handleExecuted(
  provider: ethers.Provider,
  e: { token: string; batchId: bigint; totalIn: bigint; bnbReceived: bigint; protocolFee: bigint; bnbForUsers: bigint; event: ethers.EventLog },
): Promise<void> {
  const ts = await timestampOf(provider, e.event.blockNumber);
  console.log(
    `[Compactor Indexer] BatchExecuted: token=${e.token} batch=${e.batchId} bnbReceived=${e.bnbReceived}`,
  );
  await upsertBatch({
    token_address: e.token.toLowerCase(),
    batch_id: Number(e.batchId),
    status: "EXECUTED",
    total_deposited: e.totalIn.toString(),
    bnb_received: e.bnbReceived.toString(),
    bnb_for_users: e.bnbForUsers.toString(),
    protocol_fee: e.protocolFee.toString(),
    executed_at: ts,
    tx_hash: e.event.transactionHash,
    block_number: e.event.blockNumber,
  });
}

async function handleFailed(
  provider: ethers.Provider,
  e: { token: string; batchId: bigint; event: ethers.EventLog },
): Promise<void> {
  const ts = await timestampOf(provider, e.event.blockNumber);
  console.log(`[Compactor Indexer] BatchFailed: token=${e.token} batch=${e.batchId}`);
  // Ensure a row exists (in case failBatch is called on a never-deposited batch),
  // then patch only the FAILED fields so we don't clobber total_deposited/total_receipts.
  await ensureBatch(e.token, Number(e.batchId));
  await markBatchFailed({
    token_address: e.token.toLowerCase(),
    batch_id: Number(e.batchId),
    failed_at: ts,
    tx_hash: e.event.transactionHash,
    block_number: e.event.blockNumber,
  });
}

async function handleClaim(
  provider: ethers.Provider,
  kind: "BNB" | "DUST",
  e: { user: string; token: string; batchId: bigint; receiptAmount: bigint; payout: bigint; event: ethers.EventLog },
): Promise<void> {
  const ts = await timestampOf(provider, e.event.blockNumber);
  console.log(
    `[Compactor Indexer] ${kind === "BNB" ? "BnbClaimed" : "DustRedeemed"}: user=${e.user} token=${e.token} batch=${e.batchId} payout=${e.payout}`,
  );
  await upsertClaim({
    tx_hash: e.event.transactionHash,
    user_address: e.user.toLowerCase(),
    token_address: e.token.toLowerCase(),
    batch_id: Number(e.batchId),
    receipt_amount: e.receiptAmount.toString(),
    payout: e.payout.toString(),
    kind,
    block_number: e.event.blockNumber,
    claimed_at: ts,
  });
}

async function reconnect(): Promise<void> {
  console.log(`[Compactor Indexer] Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
  await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
  await connect();
}
