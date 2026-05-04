export interface BurnRecord {
  tx_hash: string;
  user_address: string;
  token_address: string;
  amount: string;
  rcy_minted: string;
  block_number: number;
  burned_at: string;
}
