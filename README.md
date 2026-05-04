# Recycle Protocol

The first on-chain refinery for Web3. Recycle Protocol lets users destroy worthless tokens (memecoins, scams, dust) in exchange for **$RCY** and an ERC-721 **Tax Loss Certificate** NFT. The liquidity extracted from those burned tokens feeds a deflationary engine that buys and burns $RCY from the open market — turning platform usage into real scarcity for the token.

Built on **BNB Smart Chain**.

---

## How it works

The protocol exposes two complementary entry points:

### 1. Incinerator — burn-for-reward (single token, immediate)

```
User approves tokens → calls burn(token, amount) + pays flat BNB fee
        │
        ├─ BNB fee  → Treasury
        ├─ Tokens   → Vault (per-token custody)
        ├─ User receives $RCY (distributed from the Rewards Pool)
        └─ User receives an ERC-721 Tax Loss Certificate (on-chain proof of the burn)
```

The reward curve is sublinear to prevent farming:

```
RCY = minReward + k × √(usdValue)
```

### 2. Compactor — dust pooling (batch swap to BNB)

For tokens too small to swap individually, users deposit into a per-token batch and receive an **ERC-1155 receipt**. When the batch fills, the multisig swaps the pooled tokens for BNB on PancakeSwap V2 and users claim their pro-rata BNB. If the batch fails, depositors can redeem the original tokens.

```
User deposits dust → Compactor pools per-token batch → ERC-1155 receipt minted
        │
        ├─ Multisig executes batch swap on Pancake V2 → BNB
        │       └─ User claims pro-rata BNB by burning the receipt
        │
        └─ Batch fails → User redeems original tokens
```

The protocol later sells the vaulted tokens. Proceeds are split **50% buyback & burn $RCY / 25% holder rewards / 15% dev / 10% marketing**, creating a closed deflationary loop.

---

## Repository layout

This is a **pnpm monorepo** with three workspaces:

| Workspace | Stack | Purpose |
|---|---|---|
| `contracts/` | Hardhat · Solidity 0.8.28 · OpenZeppelin 5 | Smart contracts and deploy scripts |
| `backend/`   | Express · ethers · Supabase · PDFKit | Indexes `LogBurn` and Compactor events; serves PDF certificates |
| `frontend/`  | Next.js 16 · React 19 · Wagmi 2 · Reown AppKit | Burn UI, Compactor UI, stats and transactions pages |

### Smart contracts

| Contract | Role |
|---|---|
| `Incinerator.sol`           | Main entry point — handles burn logic, RCY distribution, NFT minting |
| `RCYToken.sol`              | ERC-20, fixed 1 B supply, `BURNER_ROLE` for `BuybackBurner` |
| `TaxLossCertificate.sol`    | ERC-721 minted per burn — records token, amount, USD value, timestamp |
| `BuybackBurner.sol`         | Buys $RCY on PancakeSwap V2 with BNB proceeds, then burns it |
| `Vault.sol`                 | Per-token custody — only `Incinerator` deposits, only `PoolManager` withdraws |
| `Compactor.sol`             | Pools dust deposits per token; batches Pancake V2 swaps; pro-rata BNB claims |
| `RCYFractionalReceipt.sol`  | ERC-1155 receipt minted by `Compactor` — burnable to claim BNB or redeem tokens |
| `PriceOracle.sol`           | TWAP + Chainlink fallback for USD valuation |
| `PoolManager.sol`           | Sells vaulted tokens; splits BNB proceeds 50/25/15/10 |
| `MilestoneVesting.sol`      | 150 M $RCY team vesting unlocked by metric-based milestones |

---

## Getting started

### Prerequisites

- Node.js ≥ 18
- pnpm 9
- A wallet with testnet BNB if you want to deploy to BSC Testnet ([faucet](https://testnet.bnbchain.org/faucet-smart))

### Install

```bash
pnpm install
```

### Environment variables

Copy the example files and fill in your values:

```bash
cp contracts/.env.example contracts/.env
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env
```

Required keys:

- `contracts/.env` — `DEPLOYER_PRIVATE_KEY`, optional `BSCSCAN_API_KEY`, distribution wallets
- `backend/.env` — `RPC_URL`, `INCINERATOR_ADDRESS`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `frontend/.env` — `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`, `NEXT_PUBLIC_CHAIN_ID`, contract addresses

---

## Common commands

Run from the repo root:

```bash
pnpm dev                # Start all three services concurrently
pnpm compile            # Compile contracts
pnpm test:contracts     # Run contract tests
pnpm deploy:local       # Deploy to a local Hardhat node
pnpm deploy:testnet     # Deploy to BSC Testnet (chain 97)
pnpm contracts:node     # Hardhat local node on :8545
pnpm backend:dev        # Express API on :3001
pnpm frontend:dev       # Next.js on :3000
```

Workspace-specific:

```bash
cd contracts && npx hardhat test test/Incinerator.test.ts
cd contracts && npx hardhat verify --network bscTestnet <address>
cd contracts && slither .
cd frontend  && npm run lint && npm run build
```

---

## Deployment flow

1. `pnpm compile && pnpm test:contracts`
2. Set `DEPLOYER_PRIVATE_KEY` and the distribution wallets in `contracts/.env`
3. `pnpm deploy:testnet` — addresses are written to `contracts/deployments/<network>.json`
4. Copy the deployed addresses into `backend/.env` and `frontend/.env`
5. Start the backend and frontend, connect a wallet, and burn a test ERC-20

The deploy script also handles role grants (`MINTER_ROLE`, `MANAGER_ROLE`, `BURNER_ROLE`) and the full RCY supply distribution. Treasury and admin roles should be transferred to a Gnosis Safe + TimelockController after deploy — see the comment block in `contracts/scripts/deploy.ts`.

---

## Status

Early-stage. Core contracts (`Incinerator`, `RCYToken`, `TaxLossCertificate`, `BuybackBurner`, `Compactor`, `RCYFractionalReceipt`) are implemented and unit-tested. `PriceOracle`, `PoolManager`, and `MilestoneVesting` are present but pending audit. Not deployed to mainnet.

---

## License

TBD.
