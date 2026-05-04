import dotenv from "dotenv";
dotenv.config();

function require_env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/// @notice Comma-separated list of allowed CORS origins. If empty, CORS is wide
///         open (suitable for local dev only). In production this MUST be set.
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  rpcUrl: require_env("RPC_URL"),
  chainId: parseInt(process.env.CHAIN_ID || "56", 10),
  incineratorAddress: require_env("INCINERATOR_ADDRESS"),
  compactorAddress: require_env("COMPACTOR_ADDRESS"),
  supabaseUrl: require_env("SUPABASE_URL"),
  supabaseServiceKey: require_env("SUPABASE_SERVICE_KEY"),
  corsOrigins,
};
