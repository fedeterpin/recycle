/**
 * deploy-local.ts — deploys the full protocol to a local Hardhat node.
 *
 * Differences from deploy.ts (mainnet):
 *  - Uses MockPriceOracle instead of PriceOracle (no PancakeSwap/Chainlink needed)
 *  - All wallets default to the deployer account
 *  - Saves addresses to deployments/localhost.json
 */

import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  const FLAT_FEE   = ethers.parseEther("0.001");
  const MIN_REWARD = ethers.parseEther("10");
  // See deploy.ts for the calibration derivation. usdValue is 18-decimal so
  // sqrt($1) = 1e9, and we want $1 → 100 RCY from the curve term → k = 1e11.
  const REWARD_K   = 100_000_000_000n;

  const REWARDS_POOL     = ethers.parseEther("340000000");
  const PRESALE          = ethers.parseEther("200000000");
  const DEX_LIQUIDITY    = ethers.parseEther("110000000");
  const TEAM_VESTING     = ethers.parseEther("150000000");
  const MARKETING        = ethers.parseEther("120000000");
  const PROTOCOL_RESERVE = ethers.parseEther("80000000");

  // ── 1. RCYToken ──────────────────────────────────────────────────────────────
  console.log("\n1. Deploying RCYToken...");
  const RCYToken = await ethers.getContractFactory("RCYToken");
  const rcy = await RCYToken.deploy(deployer.address);
  await rcy.waitForDeployment();
  const rcyAddress = await rcy.getAddress();
  console.log(`   RCYToken: ${rcyAddress}`);

  // ── 2. Vault ─────────────────────────────────────────────────────────────────
  console.log("\n2. Deploying Vault...");
  const Vault = await ethers.getContractFactory("Vault");
  const vault = await Vault.deploy(deployer.address);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`   Vault: ${vaultAddress}`);

  // ── 3. MockPriceOracle ───────────────────────────────────────────────────────
  console.log("\n3. Deploying MockPriceOracle...");
  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await MockPriceOracle.deploy();
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  // Default: $1 USD per token unit (1e18)
  await oracle.setUsdValue(ethers.parseEther("1"));
  console.log(`   MockPriceOracle: ${oracleAddress}`);

  // ── 4. TaxLossCertificate ────────────────────────────────────────────────────
  console.log("\n4. Deploying TaxLossCertificate...");
  const TaxLossCertificate = await ethers.getContractFactory("TaxLossCertificate");
  const certificate = await TaxLossCertificate.deploy(deployer.address);
  await certificate.waitForDeployment();
  const certificateAddress = await certificate.getAddress();
  console.log(`   TaxLossCertificate: ${certificateAddress}`);

  // ── 5. Incinerator ───────────────────────────────────────────────────────────
  console.log("\n5. Deploying Incinerator...");
  const Incinerator = await ethers.getContractFactory("Incinerator");
  const incinerator = await Incinerator.deploy(
    rcyAddress,
    vaultAddress,
    oracleAddress,
    certificateAddress,
    deployer.address, // treasury
    FLAT_FEE,
    MIN_REWARD,
    REWARD_K
  );
  await incinerator.waitForDeployment();
  const incineratorAddress = await incinerator.getAddress();
  console.log(`   Incinerator: ${incineratorAddress}`);

  // ── 6. BuybackBurner ─────────────────────────────────────────────────────────
  console.log("\n6. Deploying BuybackBurner...");
  const BuybackBurner = await ethers.getContractFactory("BuybackBurner");
  const buybackBurner = await BuybackBurner.deploy(rcyAddress, deployer.address);
  await buybackBurner.waitForDeployment();
  const buybackBurnerAddress = await buybackBurner.getAddress();
  console.log(`   BuybackBurner: ${buybackBurnerAddress}`);

  // ── 7. PoolManager ───────────────────────────────────────────────────────────
  console.log("\n7. Deploying PoolManager...");
  const PoolManager = await ethers.getContractFactory("PoolManager");
  const poolManager = await PoolManager.deploy(
    vaultAddress,
    buybackBurnerAddress,
    deployer.address, // holders wallet
    deployer.address, // dev wallet
    deployer.address, // marketing wallet
    deployer.address  // admin
  );
  await poolManager.waitForDeployment();
  const poolManagerAddress = await poolManager.getAddress();
  console.log(`   PoolManager: ${poolManagerAddress}`);

  // ── 8. MilestoneVesting ──────────────────────────────────────────────────────
  console.log("\n8. Deploying MilestoneVesting...");
  const MilestoneVesting = await ethers.getContractFactory("MilestoneVesting");
  const vesting = await MilestoneVesting.deploy(rcyAddress, deployer.address);
  await vesting.waitForDeployment();
  const vestingAddress = await vesting.getAddress();
  console.log(`   MilestoneVesting: ${vestingAddress}`);

  // ── 9. MockPancakeRouter (localhost only) ────────────────────────────────────
  // BSC mainnet PancakeSwap V2 router is unreachable from a local Hardhat node,
  // so on localhost we deploy a mock that pays BNB at a configurable rate and
  // gets pre-funded with BNB for tests/manual swaps.
  const PANCAKE_V2_MAINNET = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
  let routerAddress: string;
  let mockRouterAddress: string | null = null;
  if (network.name === "localhost" || network.name === "hardhat") {
    console.log("\n9. Deploying MockPancakeRouter...");
    const MockRouter = await ethers.getContractFactory("MockPancakeRouter");
    const wbnb = "0x000000000000000000000000000000000000bEEF"; // placeholder
    const mockRouter = await MockRouter.deploy(wbnb);
    await mockRouter.waitForDeployment();
    mockRouterAddress = await mockRouter.getAddress();
    routerAddress = mockRouterAddress;
    await deployer.sendTransaction({
      to: mockRouterAddress,
      value: ethers.parseEther("100"),
    });
    console.log(`   MockPancakeRouter: ${mockRouterAddress} (funded with 100 BNB)`);
  } else {
    routerAddress = PANCAKE_V2_MAINNET;
    console.log(`\n9. Using mainnet PancakeSwap V2 router: ${routerAddress}`);
  }

  // ── 10. RCYFractionalReceipt ─────────────────────────────────────────────────
  console.log("\n10. Deploying RCYFractionalReceipt...");
  const RCYFractionalReceipt = await ethers.getContractFactory("RCYFractionalReceipt");
  const receipt = await RCYFractionalReceipt.deploy(deployer.address);
  await receipt.waitForDeployment();
  const receiptAddress = await receipt.getAddress();
  console.log(`   RCYFractionalReceipt: ${receiptAddress}`);

  // ── 11. Compactor ────────────────────────────────────────────────────────────
  console.log("\n11. Deploying Compactor...");
  const Compactor = await ethers.getContractFactory("Compactor");
  const compactor = await Compactor.deploy(
    receiptAddress,
    routerAddress,
    deployer.address, // treasury
    deployer.address, // admin (also EXECUTOR_ROLE)
  );
  await compactor.waitForDeployment();
  const compactorAddress = await compactor.getAddress();
  console.log(`   Compactor: ${compactorAddress}`);

  // ── 12. Grant roles ──────────────────────────────────────────────────────────
  console.log("\n12. Granting roles...");
  await certificate.grantRole(await certificate.MINTER_ROLE(), incineratorAddress);
  await vault.grantRole(await vault.MANAGER_ROLE(), poolManagerAddress);
  await rcy.grantRole(await rcy.BURNER_ROLE(), buybackBurnerAddress);
  await buybackBurner.grantRole(await buybackBurner.CALLER_ROLE(), poolManagerAddress);
  await receipt.grantRole(await receipt.MINTER_ROLE(), compactorAddress);
  await receipt.grantRole(await receipt.BURNER_ROLE(), compactorAddress);
  console.log("   Roles granted.");

  // ── 13. Distribute RCY supply ─────────────────────────────────────────────────
  console.log("\n13. Distributing RCY supply...");
  await rcy.transfer(incineratorAddress, REWARDS_POOL);
  await rcy.transfer(deployer.address,   PRESALE);           // presale wallet = deployer
  await rcy.transfer(deployer.address,   DEX_LIQUIDITY);     // liquidity wallet = deployer
  await rcy.transfer(deployer.address,   MARKETING);         // marketing wallet = deployer
  await rcy.transfer(deployer.address,   PROTOCOL_RESERVE);  // reserve wallet = deployer
  await rcy.transfer(vestingAddress,     TEAM_VESTING);
  console.log("   Supply distributed.");

  // ── 14. Save addresses ────────────────────────────────────────────────────────
  const deployments = {
    network: network.name,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      RCYToken: rcyAddress,
      Vault: vaultAddress,
      PriceOracle: oracleAddress,
      TaxLossCertificate: certificateAddress,
      Incinerator: incineratorAddress,
      BuybackBurner: buybackBurnerAddress,
      PoolManager: poolManagerAddress,
      MilestoneVesting: vestingAddress,
      RCYFractionalReceipt: receiptAddress,
      Compactor: compactorAddress,
      ...(mockRouterAddress ? { MockPancakeRouter: mockRouterAddress } : {}),
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);
  const outPath = path.join(deploymentsDir, "localhost.json");
  fs.writeFileSync(outPath, JSON.stringify(deployments, null, 2));

  console.log(`\n✅ Deploy local completo. Direcciones en deployments/localhost.json`);
  console.log(`\n   INCINERATOR_ADDRESS=${incineratorAddress}`);
  console.log(`   RCY_TOKEN_ADDRESS=${rcyAddress}`);
  console.log(`   COMPACTOR_ADDRESS=${compactorAddress}`);
  console.log(`   RECEIPT_ADDRESS=${receiptAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
