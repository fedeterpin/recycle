import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";

const BUCKET = "certificates";

let _client: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (!_client) {
    _client = createClient(config.supabaseUrl, config.supabaseServiceKey);
  }
  return _client;
}

function objectPath(txHash: string): string {
  return `${txHash.toLowerCase()}.pdf`;
}

/// @notice Stores a generated certificate PDF. Uses upsert so retries are safe.
export async function putCertificate(txHash: string, pdf: Buffer): Promise<void> {
  const { error } = await client()
    .storage
    .from(BUCKET)
    .upload(objectPath(txHash), pdf, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) throw error;
}

/// @notice Returns the cached certificate, or null if it has not been generated yet.
export async function getCertificate(txHash: string): Promise<Buffer | null> {
  const { data, error } = await client()
    .storage
    .from(BUCKET)
    .download(objectPath(txHash));

  if (error) {
    // Supabase returns a generic error for missing objects — treat as cache miss.
    if (/not found|object not found/i.test(error.message)) return null;
    throw error;
  }

  return Buffer.from(await data.arrayBuffer());
}
