import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";

export interface CompactorDeposit {
  tx_hash: string;
  user_address: string;
  token_address: string;
  batch_id: number;
  amount: string;
  receipt_token_id: string;
  block_number: number;
  deposited_at: string;
}

export type BatchStatus = "OPEN" | "EXECUTED" | "FAILED";

export interface CompactorBatch {
  token_address: string;
  batch_id: number;
  status: BatchStatus;
  total_deposited: string; // also used as the receipt supply (1:1 with deposits)
  bnb_received?: string | null;
  bnb_for_users?: string | null;
  protocol_fee?: string | null;
  executed_at?: string | null;
  failed_at?: string | null;
  tx_hash?: string | null;
  block_number?: number | null;
}

export type ClaimKind = "BNB" | "DUST";

export interface CompactorClaim {
  tx_hash: string;
  user_address: string;
  token_address: string;
  batch_id: number;
  receipt_amount: string;
  payout: string;
  kind: ClaimKind;
  block_number: number;
  claimed_at: string;
}

let _client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!_client) _client = createClient(config.supabaseUrl, config.supabaseServiceKey);
  return _client;
}

export async function upsertDeposit(record: CompactorDeposit): Promise<void> {
  const { error } = await getClient()
    .from("compactor_deposits")
    .upsert(record, { onConflict: "tx_hash" });
  if (error) {
    console.error("[DB] upsertDeposit error:", error.message);
    throw error;
  }
}

/// Insert-or-create a batch row when first seen via DustDeposited. Avoids
/// clobbering totals later set by BatchExecuted by using `ignoreDuplicates`.
export async function ensureBatch(token: string, batchId: number): Promise<void> {
  const { error } = await getClient()
    .from("compactor_batches")
    .upsert(
      {
        token_address: token.toLowerCase(),
        batch_id: batchId,
        status: "OPEN" as BatchStatus,
        total_deposited: "0",
      },
      { onConflict: "token_address,batch_id", ignoreDuplicates: true },
    );
  if (error) {
    console.error("[DB] ensureBatch error:", error.message);
    throw error;
  }
}

/// @notice Bumps `total_deposited` and `total_receipts` for an OPEN batch.
///         Read-modify-write: deposits arrive sequentially through the
///         listener, so the small race window is acceptable for v1.
///         Once a batch is EXECUTED, BatchExecuted overwrites these with the
///         authoritative on-chain `totalIn`.
export async function bumpBatchTotals(
  token: string,
  batchId: number,
  delta: bigint,
): Promise<void> {
  const client = getClient();
  const lower = token.toLowerCase();
  const { data, error } = await client
    .from("compactor_batches")
    .select("status, total_deposited")
    .eq("token_address", lower)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (error) {
    console.error("[DB] bumpBatchTotals read error:", error.message);
    throw error;
  }
  if (!data || data.status !== "OPEN") return; // don't clobber EXECUTED/FAILED rows
  const newDeposited = (BigInt(data.total_deposited ?? "0") + delta).toString();
  const { error: updErr } = await client
    .from("compactor_batches")
    .update({ total_deposited: newDeposited })
    .eq("token_address", lower)
    .eq("batch_id", batchId);
  if (updErr) {
    console.error("[DB] bumpBatchTotals update error:", updErr.message);
    throw updErr;
  }
}

export async function upsertBatch(record: CompactorBatch): Promise<void> {
  const { error } = await getClient()
    .from("compactor_batches")
    .upsert(record, { onConflict: "token_address,batch_id" });
  if (error) {
    console.error("[DB] upsertBatch error:", error.message);
    throw error;
  }
}

export async function markBatchFailed(patch: {
  token_address: string;
  batch_id: number;
  failed_at: string;
  tx_hash: string;
  block_number: number;
}): Promise<void> {
  const { error } = await getClient()
    .from("compactor_batches")
    .update({
      status: "FAILED" as BatchStatus,
      failed_at: patch.failed_at,
      tx_hash: patch.tx_hash,
      block_number: patch.block_number,
    })
    .eq("token_address", patch.token_address)
    .eq("batch_id", patch.batch_id);
  if (error) {
    console.error("[DB] markBatchFailed error:", error.message);
    throw error;
  }
}

export async function upsertClaim(record: CompactorClaim): Promise<void> {
  const { error } = await getClient()
    .from("compactor_claims")
    .upsert(record, { onConflict: "tx_hash" });
  if (error) {
    console.error("[DB] upsertClaim error:", error.message);
    throw error;
  }
}

export async function getBatchesByToken(token: string): Promise<CompactorBatch[]> {
  const { data, error } = await getClient()
    .from("compactor_batches")
    .select("*")
    .eq("token_address", token.toLowerCase())
    .order("batch_id", { ascending: false });
  if (error) throw error;
  return (data as CompactorBatch[]) ?? [];
}

export async function getBatch(
  token: string,
  batchId: number,
): Promise<CompactorBatch | null> {
  const { data, error } = await getClient()
    .from("compactor_batches")
    .select("*")
    .eq("token_address", token.toLowerCase())
    .eq("batch_id", batchId)
    .maybeSingle();
  if (error) throw error;
  return (data as CompactorBatch) ?? null;
}

export interface WalletReceipt {
  token_address: string;
  batch_id: number;
  current_amount: string; // remaining receipt balance (deposits - claims/redeems) for this wallet
  status: BatchStatus;
  total_receipts: string | null; // == total_deposited (1:1)
  bnb_for_users: string | null;
}

/// @notice Returns each (token, batch) where the wallet has a non-zero
///         remaining receipt balance. Computed from deposits − claims/redeems
///         on the assumption that receipts are not transferred between wallets
///         (true for v1; can be hardened later by indexing ERC-1155 transfers).
export async function getReceiptsByWallet(wallet: string): Promise<WalletReceipt[]> {
  const lower = wallet.toLowerCase();
  const client = getClient();

  const [{ data: deposits, error: dErr }, { data: claims, error: cErr }] = await Promise.all([
    client
      .from("compactor_deposits")
      .select("token_address, batch_id, amount, deposited_at")
      .eq("user_address", lower),
    client
      .from("compactor_claims")
      .select("token_address, batch_id, receipt_amount")
      .eq("user_address", lower),
  ]);
  if (dErr) throw dErr;
  if (cErr) throw cErr;

  const totals = new Map<string, { token: string; batch: number; deposited: bigint; claimed: bigint }>();
  for (const d of (deposits ?? []) as Array<{ token_address: string; batch_id: number; amount: string }>) {
    const k = `${d.token_address}/${d.batch_id}`;
    const cur = totals.get(k) ?? { token: d.token_address, batch: d.batch_id, deposited: 0n, claimed: 0n };
    cur.deposited += BigInt(d.amount);
    totals.set(k, cur);
  }
  for (const c of (claims ?? []) as Array<{ token_address: string; batch_id: number; receipt_amount: string }>) {
    const k = `${c.token_address}/${c.batch_id}`;
    const cur = totals.get(k);
    if (!cur) continue;
    cur.claimed += BigInt(c.receipt_amount);
  }

  const live = Array.from(totals.values()).filter((t) => t.deposited > t.claimed);
  if (live.length === 0) return [];

  // Fetch batch rows for the live (token, batch) pairs to attach status/payout info.
  const tokens = Array.from(new Set(live.map((l) => l.token)));
  const { data: batches, error: bErr } = await client
    .from("compactor_batches")
    .select("token_address, batch_id, status, total_deposited, bnb_for_users")
    .in("token_address", tokens);
  if (bErr) throw bErr;

  const batchByKey = new Map<string, { status: BatchStatus; total_deposited: string | null; bnb_for_users: string | null }>();
  for (const b of (batches ?? []) as Array<{ token_address: string; batch_id: number; status: BatchStatus; total_deposited: string | null; bnb_for_users: string | null }>) {
    batchByKey.set(`${b.token_address}/${b.batch_id}`, {
      status: b.status,
      total_deposited: b.total_deposited,
      bnb_for_users: b.bnb_for_users,
    });
  }

  return live.map((l) => {
    const meta = batchByKey.get(`${l.token}/${l.batch}`);
    return {
      token_address: l.token,
      batch_id: l.batch,
      current_amount: (l.deposited - l.claimed).toString(),
      status: meta?.status ?? ("OPEN" as BatchStatus),
      total_receipts: meta?.total_deposited ?? null, // 1:1 with deposits
      bnb_for_users: meta?.bnb_for_users ?? null,
    };
  });
}

export interface CompactorAggregateStats {
  total_batches: number;
  open_batches: number;
  executed_batches: number;
  failed_batches: number;
  total_bnb_distributed: string;
}

export async function getCompactorStats(): Promise<CompactorAggregateStats> {
  const client = getClient();
  const { data: batches, error } = await client
    .from("compactor_batches")
    .select("status, bnb_for_users");
  if (error) throw error;

  let total = 0;
  let open = 0;
  let executed = 0;
  let failed = 0;
  let bnbSum = 0n;
  for (const b of (batches ?? []) as Array<{ status: BatchStatus; bnb_for_users: string | null }>) {
    total++;
    if (b.status === "OPEN") open++;
    else if (b.status === "EXECUTED") executed++;
    else if (b.status === "FAILED") failed++;
    if (b.bnb_for_users) bnbSum += BigInt(b.bnb_for_users);
  }

  return {
    total_batches: total,
    open_batches: open,
    executed_batches: executed,
    failed_batches: failed,
    total_bnb_distributed: bnbSum.toString(),
  };
}

export async function getLastIndexedCompactorBlock(): Promise<number | null> {
  const client = getClient();
  const tables = ["compactor_deposits", "compactor_batches", "compactor_claims"] as const;
  const results = await Promise.all(
    tables.map((t) =>
      client
        .from(t)
        .select("block_number")
        .order("block_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  );
  let max: number | null = null;
  for (const r of results) {
    if (r.error) continue;
    const v = (r.data as { block_number: number | null } | null)?.block_number;
    if (v != null && (max == null || v > max)) max = v;
  }
  return max;
}
