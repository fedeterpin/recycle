# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Recycle Protocol is a Web3 DeFi protocol on BSC where users burn worthless memecoins in exchange for $RCY tokens and an ERC-721 Tax Loss Certificate NFT. It is a **pnpm monorepo** with three workspaces: `contracts`, `backend`, and `frontend`.

## Commands

### Root (run from repo root)

```bash
pnpm dev                # Start all three services concurrently
pnpm compile            # Compile Solidity contracts
pnpm test:contracts     # Run contract tests (Hardhat + Mocha)
pnpm deploy:local       # Deploy contracts to local Hardhat node
pnpm deploy:testnet     # Deploy to BSC Testnet (chain 97)
pnpm frontend:dev       # Next.js on localhost:3000
pnpm backend:dev        # Express API on localhost:3001
pnpm contracts:node     # Hardhat local node on localhost:8545
```

### Individual workspaces

```bash
# Contracts
cd contracts && npx hardhat test                         # All tests
cd contracts && npx hardhat test test/Incinerator.test.ts  # Single test file
cd contracts && npx hardhat run scripts/deploy.ts --network bscTestnet
cd contracts && npx hardhat verify --network bscTestnet <address>
cd contracts && slither .                                # Static analysis

# Backend
cd backend && npm run build   # Compile TS → dist/
cd backend && npm start       # Production

# Frontend
cd frontend && npm run lint
cd frontend && npm run build
```

## Architecture

```
User → Frontend (Next.js + Wagmi)
     → Smart Contracts (BSC)
         → Incinerator.burn(token, amount) [payable, BNB flat fee]
             → PriceOracle (TWAP + Chainlink fallback)
             → Vault (custodies burned tokens)
             → RCYToken.transfer (sqrt reward curve)
             → TaxLossCertificate.mint (ERC-721 NFT)
             → emits LogBurn
     → Backend (Express)
         → incineratorListener watches LogBurn events
         → stores burn record in Supabase
         → generates PDF certificate asynchronously
         → GET /burns?wallet=0x...
         → GET /certificates/:txHash  (PDF download)
```

### Smart Contracts (`contracts/contracts/`)

| Contract | Status | Role |
|---|---|---|
| `Incinerator.sol` | Complete (adjustments needed) | Main entry point; handles burn logic, RCY distribution, NFT minting |
| `RCYToken.sol` | Complete | ERC-20, 1B fixed supply, `BURNER_ROLE` for BuybackBurner |
| `TaxLossCertificate.sol` | Complete | ERC-721 minted per burn; records token, amount, USD value, timestamp |
| `BuybackBurner.sol` | Complete | Buys $RCY on PancakeSwap V2 with BNB proceeds, then burns it |
| `Vault.sol` | Basic | Custodies burned tokens; only Incinerator deposits, only PoolManager withdraws |
| `PriceOracle.sol` | Pending | TWAP + Chainlink for USD valuation; falls back to `minReward` |
| `PoolManager.sol` | Pending | Sells vault tokens; splits proceeds 50/25/15/10 (buyback/stakers/team/marketing) |
| `MilestoneVesting.sol` | Pending | 150M $RCY team vesting across 4 metric-based milestones |

**Reward formula:** `RCY = minReward + k × √(usdValue)` — sublinear to prevent farming.

**Hardhat config:** Solidity 0.8.28, optimizer 200 runs. Targets: `localhost`, `bscTestnet` (97), `bscMainnet` (56).

### Backend (`backend/src/`)

- `index.ts` — starts Express server + `startIncineratorListener()`
- `api/server.ts` — Express routes: `/health`, `/burns`, `/burns/:txHash`, `/certificates/:txHash`
- `indexer/incineratorListener.ts` — ethers.js event listener with 5s auto-reconnect; writes to Supabase
- `db/supabase.ts` — `insertBurn` (upsert by tx_hash), `getBurnsByWallet`, `getBurnByTxHash`
- `pdf/certificateGenerator.ts` — PDFKit; returns Buffer streamed by API
- `config.ts` — requires `RPC_URL`, `INCINERATOR_ADDRESS`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`; optional `PORT` (3001), `CHAIN_ID` (56)

### Frontend (`frontend/src/`)

- `app/` — Next.js 14 App Router; `/incinerator` is the main user page
- `components/incinerator/IncineratorModule.tsx` — state machine: `idle → approving → burning → done`
- `components/incinerator/BurnForm.tsx` — two-step UI: Approve then Burn
- `hooks/useBurn.ts` — Wagmi hooks wrapping approve + burn contract calls; exposes `flatFee`, `approveConfirmed`, `txHash`
- `lib/wagmiConfig.ts` — chains: BSC (56), BSC Testnet (97), Hardhat (31337); reads `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_API_URL`
- `components/Providers.tsx` — WagmiProvider + QueryClientProvider + Web3Modal

## Key Design Decisions

- **Honeypot protection:** `Incinerator` uses `try/catch` when transferring tokens to Vault; failed transfers emit `LogBurnFailed` instead of reverting.
- **No minting after deploy:** RCY supply is fixed; rewards come from a pre-funded rewards pool (34% of supply sent to Incinerator at deploy).
- **PDF certificates are generated async** after the burn event is indexed; the frontend polls the `/certificates/:txHash` endpoint.
- **PoolManager is manual in v1:** Vault liquidation is triggered by Multisig, not automated.

## Design Documentation

Full protocol specification (Spanish) at `docs/protocol-design.md` — covers tokenomics, deflation mechanics, NFT spec, and the phased roadmap.
