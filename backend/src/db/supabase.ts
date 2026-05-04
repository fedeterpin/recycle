import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";

export interface BurnRecord {
  tx_hash: string;
  user_address: string;
  token_address: string;
  amount: string;
  usd_value: string;
  rcy_rewarded: string;
  certificate_id: string;
  block_number: number;
  burned_at: string;
}

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(config.supabaseUrl, config.supabaseServiceKey);
  }
  return _client;
}

export async function insertBurn(record: BurnRecord): Promise<void> {
  const { error } = await getClient()
    .from("burns")
    .upsert(record, { onConflict: "tx_hash" });

  if (error) {
    console.error("[DB] insertBurn error:", error.message);
    throw error;
  }
}

export async function getBurnsByWallet(wallet: string): Promise<BurnRecord[]> {
  const { data, error } = await getClient()
    .from("burns")
    .select("*")
    .eq("user_address", wallet.toLowerCase())
    .order("burned_at", { ascending: false });

  if (error) throw error;
  return (data as BurnRecord[]) ?? [];
}

export async function getBurnByTxHash(txHash: string): Promise<BurnRecord | null> {
  const { data, error } = await getClient()
    .from("burns")
    .select("*")
    .eq("tx_hash", txHash)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data as BurnRecord | null;
}

/// @notice Highest block_number indexed so far. Used by the listener to
///         resume from where it left off and backfill missed events on restart.
export async function getLastIndexedBlock(): Promise<number | null> {
  const { data, error } = await getClient()
    .from("burns")
    .select("block_number")
    .order("block_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.block_number ?? null;
}
