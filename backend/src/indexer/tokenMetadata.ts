import { ethers } from "ethers";

const ERC20_METADATA_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export interface TokenMetadata {
  decimals: number;
  symbol: string;
}

const cache = new Map<string, TokenMetadata>();

/// @notice Reads decimals and symbol for an ERC-20.
///         Falls back to (18, "UNKNOWN") if either call reverts — common with
///         non-standard tokens. Results are cached forever (token metadata is
///         immutable in practice).
export async function getTokenMetadata(
  provider: ethers.Provider,
  token: string,
): Promise<TokenMetadata> {
  const key = token.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const contract = new ethers.Contract(token, ERC20_METADATA_ABI, provider);

  const [decimals, symbol] = await Promise.all([
    contract.decimals().catch(() => 18),
    contract.symbol().catch(() => "UNKNOWN"),
  ]);

  const meta: TokenMetadata = { decimals: Number(decimals), symbol };
  cache.set(key, meta);
  return meta;
}
