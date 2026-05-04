/**
 * tune-and-refill.ts — recalibrates the local environment after a fresh
 * deploy-local: sets the MockPriceOracle to a realistic USD value, applies
 * the correctly-calibrated reward parameters to the Incinerator (in case
 * the deployment used the old miscalibrated k), and refills the rewards
 * pool so the user can keep burning without draining it on the first call.
 */

import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployments = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "deployments", `${network.name}.json`),
      "utf-8"
    )
  );
  const {
    RCYToken: rcyAddr,
    PriceOracle: oracleAddr,
    Incinerator: incinerator,
  } = deployments.contracts;

  console.log(`Network:     ${network.name}`);
  console.log(`Deployer:    ${deployer.address}`);
  console.log(`Incinerator: ${incinerator}\n`);

  // 1. Set the mock oracle to return $1 (1e18 in 18-dec fixed point).
  //    Combined with the calibrated k below, each burn yields ~110 RCY,
  //    matching the whitepaper §2.3 reward table.
  const oracle = await ethers.getContractAt("MockPriceOracle", oracleAddr);
  const ONE_USD = ethers.parseEther("1");
  await oracle.setUsdValue(ONE_USD);
  console.log(`✓ MockPriceOracle.usdValue → $1 (1e18 wei in 18-dec fixed point)`);

  // 2. Push the calibrated reward params onto the Incinerator. This is a
  //    no-op if the Incinerator was deployed with the new deploy-local.ts;
  //    it heals existing deployments that used the old miscalibrated k.
  const incinerator_ = await ethers.getContractAt("Incinerator", incinerator);
  const MIN_REWARD = ethers.parseEther("10");
  const REWARD_K = 100_000_000_000n; // 1e11 wei — see deploy.ts for derivation
  const tx = await incinerator_.setRewardParams(MIN_REWARD, REWARD_K);
  await tx.wait();
  console.log(`✓ Incinerator reward params → minReward=10 RCY, k=1e11 wei`);
  console.log(`  Expected reward at $1 burn: ${ethers.formatEther(MIN_REWARD + REWARD_K * 1_000_000_000n)} RCY`);

  // 3. Refill the Incinerator's rewards pool from the deployer (which holds
  //    every wallet allocation locally — presale, liquidity, marketing, etc).
  const rcy = await ethers.getContractAt("RCYToken", rcyAddr);
  const incBalance = await rcy.balanceOf(incinerator);
  const target = ethers.parseEther("340000000");

  console.log(`\nIncinerator balance:  ${ethers.formatEther(incBalance)} RCY`);
  console.log(`Target balance:       ${ethers.formatEther(target)} RCY`);

  if (incBalance < target) {
    const refill = target - incBalance;
    const deployerBalance = await rcy.balanceOf(deployer.address);
    if (deployerBalance < refill) {
      console.error(
        `\n✗ Deployer only has ${ethers.formatEther(deployerBalance)} RCY, need ${ethers.formatEther(refill)}.`
      );
      process.exit(1);
    }
    const transferTx = await rcy.transfer(incinerator, refill);
    await transferTx.wait();
    console.log(`\n✓ Transferred ${ethers.formatEther(refill)} RCY → Incinerator`);
  } else {
    console.log(`\n✓ Pool already at or above target — no refill needed`);
  }

  const finalIncBalance = await rcy.balanceOf(incinerator);
  const finalDeployerBalance = await rcy.balanceOf(deployer.address);
  console.log(`\n── Final balances ──`);
  console.log(`Incinerator:  ${ethers.formatEther(finalIncBalance)} RCY`);
  console.log(`Deployer:     ${ethers.formatEther(finalDeployerBalance)} RCY`);
  console.log(`\n✅ Done. Each $1 burn now yields ~110 RCY.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
