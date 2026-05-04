/**
 * tune-and-refill.ts — recalibrates the local MockPriceOracle to give sensible
 * RCY rewards, and refills the Incinerator rewards pool from the deployer.
 *
 * Run after deploy-local.ts when the rewards pool has been drained or when
 * burns are returning amounts that are way too large.
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
  const { RCYToken: rcyAddr, PriceOracle: oracleAddr, Incinerator: incinerator } =
    deployments.contracts;

  console.log(`Network:     ${network.name}`);
  console.log(`Deployer:    ${deployer.address}`);
  console.log(`Incinerator: ${incinerator}\n`);

  // 1. Tune the oracle. With usdValue=1 (wei in 18-dec terms):
  //    reward = minReward + rewardK * sqrt(1) = 10e18 + 100e18 * 1 = 110 RCY
  const oracle = await ethers.getContractAt("MockPriceOracle", oracleAddr);
  await oracle.setUsdValue(1n);
  console.log(`✓ MockPriceOracle.usdValue set to 1 wei → reward = ~110 RCY/burn`);

  // 2. Refill the Incinerator's rewards pool
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
    const tx = await rcy.transfer(incinerator, refill);
    await tx.wait();
    console.log(`\n✓ Transferred ${ethers.formatEther(refill)} RCY from deployer → Incinerator`);
  } else {
    console.log(`\n✓ Pool already at or above target — no refill needed`);
  }

  const finalIncBalance = await rcy.balanceOf(incinerator);
  const finalDeployerBalance = await rcy.balanceOf(deployer.address);
  console.log(`\n── Final balances ──`);
  console.log(`Incinerator:  ${ethers.formatEther(finalIncBalance)} RCY`);
  console.log(`Deployer:     ${ethers.formatEther(finalDeployerBalance)} RCY`);
  console.log(`\n✅ Done. You can now burn again — each burn ≈ 110 RCY.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
