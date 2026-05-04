import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying on network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  // ── External addresses — edit before deploying ─────────────────────────────
  // BSC Mainnet
  const WBNB          = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
  const PANCAKE_V3    = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";
  const PANCAKE_V2    = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
  const CHAINLINK_BNB = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE"; // BNB/USD

  // ── Protocol config — edit before deploying ────────────────────────────────
  const TREASURY    = process.env.TREASURY_ADDRESS || deployer.address;
  const FLAT_FEE    = ethers.parseEther("0.001");   // 0.001 BNB per burn
  const MIN_REWARD  = ethers.parseEther("10");       // 10 RCY for tokens without price

  // Reward curve coefficient k in: RCY = minReward + k * sqrt(usdValue)
  // The PriceOracle returns usdValue with 18 decimals, so sqrt($1) = sqrt(1e18) = 1e9.
  // To make a $1 burn produce 100 RCY (= 100e18 wei) from the curve term,
  // we need k * 1e9 = 100e18 → k = 1e11 wei.
  // With this, $100 → 1010 RCY and $10,000 → 10,010 RCY (matches whitepaper §2.3).
  const REWARD_K    = 100_000_000_000n;              // 1e11 wei — see comment above

  // ── Supply distribution (must sum to 1,000,000,000) ───────────────────────
  const TOTAL              = ethers.parseEther("1000000000");
  const REWARDS_POOL       = ethers.parseEther("340000000");  // 34% → Incinerator
  const PRESALE            = ethers.parseEther("200000000");  // 20% → PinkSale wallet
  const DEX_LIQUIDITY      = ethers.parseEther("110000000");  // 11% → LP wallet
  const TEAM_VESTING       = ethers.parseEther("150000000");  // 15% → MilestoneVesting
  const MARKETING          = ethers.parseEther("120000000");  // 12% → marketing wallet
  const PROTOCOL_RESERVE   = ethers.parseEther("80000000");   // 8%  → multisig

  const PRESALE_WALLET   = process.env.PRESALE_WALLET   || deployer.address;
  const LIQUIDITY_WALLET = process.env.LIQUIDITY_WALLET || deployer.address;
  const MARKETING_WALLET = process.env.MARKETING_WALLET || deployer.address;
  const RESERVE_WALLET   = process.env.RESERVE_WALLET   || deployer.address;

  // ── 1. RCY Token ──────────────────────────────────────────────────────────
  console.log("\n1. Deploying RCYToken...");
  const RCYToken = await ethers.getContractFactory("RCYToken");
  const rcy = await RCYToken.deploy(deployer.address);
  await rcy.waitForDeployment();
  const rcyAddress = await rcy.getAddress();
  console.log(`   RCYToken deployed: ${rcyAddress}`);

  // ── 2. Vault ──────────────────────────────────────────────────────────────
  console.log("\n2. Deploying Vault...");
  const Vault = await ethers.getContractFactory("Vault");
  const vault = await Vault.deploy(deployer.address);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`   Vault deployed: ${vaultAddress}`);

  // ── 3. PriceOracle ────────────────────────────────────────────────────────
  console.log("\n3. Deploying PriceOracle...");
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const oracle = await PriceOracle.deploy(WBNB, PANCAKE_V3, PANCAKE_V2, CHAINLINK_BNB);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`   PriceOracle deployed: ${oracleAddress}`);

  // ── 4. TaxLossCertificate ─────────────────────────────────────────────────
  console.log("\n4. Deploying TaxLossCertificate...");
  const TaxLossCertificate = await ethers.getContractFactory("TaxLossCertificate");
  const certificate = await TaxLossCertificate.deploy(deployer.address);
  await certificate.waitForDeployment();
  const certificateAddress = await certificate.getAddress();
  console.log(`   TaxLossCertificate deployed: ${certificateAddress}`);

  // ── 5. Incinerator ────────────────────────────────────────────────────────
  console.log("\n5. Deploying Incinerator...");
  const Incinerator = await ethers.getContractFactory("Incinerator");
  const incinerator = await Incinerator.deploy(
    rcyAddress,
    vaultAddress,
    oracleAddress,
    certificateAddress,
    TREASURY,
    FLAT_FEE,
    MIN_REWARD,
    REWARD_K
  );
  await incinerator.waitForDeployment();
  const incineratorAddress = await incinerator.getAddress();
  console.log(`   Incinerator deployed: ${incineratorAddress}`);

  // ── 6. BuybackBurner ──────────────────────────────────────────────────────
  console.log("\n6. Deploying BuybackBurner...");
  const BuybackBurner = await ethers.getContractFactory("BuybackBurner");
  const buybackBurner = await BuybackBurner.deploy(rcyAddress);
  await buybackBurner.waitForDeployment();
  const buybackBurnerAddress = await buybackBurner.getAddress();
  console.log(`   BuybackBurner deployed: ${buybackBurnerAddress}`);

  // ── 7. PoolManager ────────────────────────────────────────────────────────
  console.log("\n7. Deploying PoolManager...");
  const HOLDERS_WALLET  = process.env.HOLDERS_WALLET  || deployer.address;
  const DEV_WALLET      = process.env.DEV_WALLET      || deployer.address;

  const PoolManager = await ethers.getContractFactory("PoolManager");
  const poolManager = await PoolManager.deploy(
    vaultAddress,
    buybackBurnerAddress,
    HOLDERS_WALLET,
    DEV_WALLET,
    MARKETING_WALLET,
    deployer.address
  );
  await poolManager.waitForDeployment();
  const poolManagerAddress = await poolManager.getAddress();
  console.log(`   PoolManager deployed: ${poolManagerAddress}`);

  // ── 8. Grant roles ────────────────────────────────────────────────────────
  console.log("\n8. Granting roles...");

  // Incinerator can mint TaxLossCertificates
  const CERT_MINTER_ROLE = await certificate.MINTER_ROLE();
  await certificate.grantRole(CERT_MINTER_ROLE, incineratorAddress);
  console.log(`   TaxLossCertificate MINTER_ROLE → Incinerator`);

  // PoolManager can withdraw from Vault
  const VAULT_MANAGER_ROLE = await vault.MANAGER_ROLE();
  await vault.grantRole(VAULT_MANAGER_ROLE, poolManagerAddress);
  console.log(`   Vault MANAGER_ROLE → PoolManager`);

  // BuybackBurner needs BURNER_ROLE on RCYToken
  const BURNER_ROLE = await rcy.BURNER_ROLE();
  await rcy.grantRole(BURNER_ROLE, buybackBurnerAddress);
  console.log(`   RCYToken BURNER_ROLE → BuybackBurner`);

  // ── 9. Distribute RCY supply ──────────────────────────────────────────────
  console.log("\n9. Distributing RCY supply...");

  await rcy.transfer(incineratorAddress, REWARDS_POOL);
  console.log(`   340,000,000 RCY → Incinerator (rewards pool)`);

  await rcy.transfer(PRESALE_WALLET, PRESALE);
  console.log(`   200,000,000 RCY → Presale wallet (PinkSale)`);

  await rcy.transfer(LIQUIDITY_WALLET, DEX_LIQUIDITY);
  console.log(`   110,000,000 RCY → Liquidity wallet (DEX)`);

  await rcy.transfer(MARKETING_WALLET, MARKETING);
  console.log(`   120,000,000 RCY → Marketing wallet`);

  await rcy.transfer(RESERVE_WALLET, PROTOCOL_RESERVE);
  console.log(`   80,000,000  RCY → Protocol reserve`);

  // ── 10. TimelockController ────────────────────────────────────────────────
  // TimelockController is deployed from OpenZeppelin — no custom contract needed.
  // After deploying the Gnosis Safe (off-chain via app.safe.global), run:
  //   rcy.grantRole(DEFAULT_ADMIN_ROLE, timelockAddress)
  //   rcy.renounceRole(DEFAULT_ADMIN_ROLE, deployer)
  //   vesting.grantRole(DEFAULT_ADMIN_ROLE, timelockAddress)
  //   vesting.grantRole(UNLOCKER_ROLE, multisigAddress)
  //   vesting.renounceRole(DEFAULT_ADMIN_ROLE, deployer)
  //   poolManager.grantRole(EXECUTOR_ROLE, multisigAddress)
  console.log("\n10. TimelockController + Gnosis Safe: deploy via OZ Defender / app.safe.global");
  console.log(`    Timelock delay: 72h (259200 seconds)`);
  console.log(`    Gnosis Safe: 3-of-5 signers`);

  // ── 11. MilestoneVesting ──────────────────────────────────────────────────
  console.log("\n11. Deploying MilestoneVesting...");
  const MilestoneVesting = await ethers.getContractFactory("MilestoneVesting");
  const vesting = await MilestoneVesting.deploy(rcyAddress, deployer.address);
  await vesting.waitForDeployment();
  const vestingAddress = await vesting.getAddress();
  console.log(`    MilestoneVesting deployed: ${vestingAddress}`);

  // Transfer team allocation to vesting contract
  await rcy.transfer(vestingAddress, TEAM_VESTING);
  console.log(`    150,000,000 RCY → MilestoneVesting`);

  // Register team beneficiaries — edit addresses and amounts before deploying
  // Example: 3 equal founders
  const FOUNDER_ALLOCATION = TEAM_VESTING / BigInt(3);
  const FOUNDER_1 = process.env.FOUNDER_1 || deployer.address;
  const FOUNDER_2 = process.env.FOUNDER_2 || deployer.address;
  const FOUNDER_3 = process.env.FOUNDER_3 || deployer.address;

  await vesting.addBeneficiary(FOUNDER_1, FOUNDER_ALLOCATION);
  await vesting.addBeneficiary(FOUNDER_2, FOUNDER_ALLOCATION);
  await vesting.addBeneficiary(FOUNDER_3, TEAM_VESTING - FOUNDER_ALLOCATION * BigInt(2)); // remainder to last
  console.log(`    3 beneficiaries registered`);

  // ── 12. Save addresses ────────────────────────────────────────────────────
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
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);
  fs.writeFileSync(
    path.join(deploymentsDir, `${network.name}.json`),
    JSON.stringify(deployments, null, 2)
  );

  console.log(`\nDeployments saved to deployments/${network.name}.json`);
  console.log("\n✅ Fases 1, 2 y 3 completas.");
  console.log("   Próximo paso: deploy Gnosis Safe (3-of-5) + TimelockController (72h)");
  console.log("   luego transferir DEFAULT_ADMIN_ROLE al Timelock y renunciar.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
