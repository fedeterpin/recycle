import type { Address } from "viem";
import RCYTokenABI from "./abis/RCYToken.json";
import IncineratorABI from "./abis/Incinerator.json";
import VaultABI from "./abis/Vault.json";
import PoolManagerABI from "./abis/PoolManager.json";
import BuybackBurnerABI from "./abis/BuybackBurner.json";
import MilestoneVestingABI from "./abis/MilestoneVesting.json";
import TaxLossCertificateABI from "./abis/TaxLossCertificate.json";
import CompactorABI from "./abis/Compactor.json";
import RCYFractionalReceiptABI from "./abis/RCYFractionalReceipt.json";

/// Each env access must be STATIC (`process.env.NEXT_PUBLIC_FOO`) so
/// Next/Turbopack inlines the value into the client bundle. Dynamic access
/// like `process.env[key]` is NOT inlined and resolves to undefined at runtime.
function required(value: string | undefined, name: string): Address {
  if (!value) throw new Error(`Missing env: ${name}`);
  return value as Address;
}

const RCY_ADDRESS         = required(process.env.NEXT_PUBLIC_RCY_TOKEN_ADDRESS,        "NEXT_PUBLIC_RCY_TOKEN_ADDRESS");
const INCINERATOR_ADDRESS = required(process.env.NEXT_PUBLIC_INCINERATOR_ADDRESS,      "NEXT_PUBLIC_INCINERATOR_ADDRESS");
const VAULT_ADDRESS       = required(process.env.NEXT_PUBLIC_VAULT_ADDRESS,            "NEXT_PUBLIC_VAULT_ADDRESS");
const POOL_MANAGER_ADDRESS= required(process.env.NEXT_PUBLIC_POOL_MANAGER_ADDRESS,     "NEXT_PUBLIC_POOL_MANAGER_ADDRESS");
const BUYBACK_ADDRESS     = required(process.env.NEXT_PUBLIC_BUYBACK_BURNER_ADDRESS,   "NEXT_PUBLIC_BUYBACK_BURNER_ADDRESS");
const VESTING_ADDRESS     = required(process.env.NEXT_PUBLIC_MILESTONE_VESTING_ADDRESS,"NEXT_PUBLIC_MILESTONE_VESTING_ADDRESS");
const CERT_ADDRESS        = required(process.env.NEXT_PUBLIC_TAX_LOSS_CERT_ADDRESS,    "NEXT_PUBLIC_TAX_LOSS_CERT_ADDRESS");
const COMPACTOR_ADDRESS   = required(process.env.NEXT_PUBLIC_COMPACTOR_ADDRESS,        "NEXT_PUBLIC_COMPACTOR_ADDRESS");
const RECEIPT_ADDRESS     = required(process.env.NEXT_PUBLIC_RECEIPT_ADDRESS,          "NEXT_PUBLIC_RECEIPT_ADDRESS");

export const CONTRACTS = {
  rcy:        { address: RCY_ADDRESS,          abi: RCYTokenABI },
  incinerator:{ address: INCINERATOR_ADDRESS,  abi: IncineratorABI },
  vault:      { address: VAULT_ADDRESS,        abi: VaultABI },
  poolManager:{ address: POOL_MANAGER_ADDRESS, abi: PoolManagerABI },
  buyback:    { address: BUYBACK_ADDRESS,      abi: BuybackBurnerABI },
  vesting:    { address: VESTING_ADDRESS,      abi: MilestoneVestingABI },
  certificate:{ address: CERT_ADDRESS,         abi: TaxLossCertificateABI },
  compactor:  { address: COMPACTOR_ADDRESS,    abi: CompactorABI },
  receipt:    { address: RECEIPT_ADDRESS,      abi: RCYFractionalReceiptABI },
} as const;

export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || "56", 10);

/// Returns a block-explorer URL for the current chain. Localhost has none.
export function explorerUrl(addressOrTx: string, type: "address" | "tx" = "address"): string | null {
  switch (CHAIN_ID) {
    case 56:    return `https://bscscan.com/${type}/${addressOrTx}`;
    case 97:    return `https://testnet.bscscan.com/${type}/${addressOrTx}`;
    default:    return null;
  }
}
