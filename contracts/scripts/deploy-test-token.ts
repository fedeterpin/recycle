/**
 * deploy-test-token.ts — deploys a MockERC20 ("TRASH") for local burn testing.
 *
 * Mints 1,000,000 TRASH to each of the first 5 Hardhat accounts so any of them
 * can be used as a "user" in the smoke test. Run AFTER deploy-local.ts.
 */

import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}\n`);

  const Mock = await ethers.getContractFactory("MockERC20");
  const trash = await Mock.deploy();
  await trash.waitForDeployment();
  const trashAddress = await trash.getAddress();
  console.log(`TRASH token deployed at: ${trashAddress}\n`);

  const amountPerAccount = ethers.parseEther("1000000"); // 1M per account
  const fundedAccounts = signers.slice(0, 5);

  for (const account of fundedAccounts) {
    await trash.mint(account.address, amountPerAccount);
    console.log(`  ✓ Minted 1,000,000 TRASH to ${account.address}`);
  }

  // Append to deployments file so backend/frontend can pick it up if desired
  const deploymentsPath = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (fs.existsSync(deploymentsPath)) {
    const existing = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
    existing.contracts.TestToken = trashAddress;
    fs.writeFileSync(deploymentsPath, JSON.stringify(existing, null, 2));
    console.log(`\nAddress saved to deployments/${network.name}.json under contracts.TestToken`);
  }

  console.log(`\n────────────────────────────────────────────`);
  console.log(`COPY THIS — you'll paste it in the frontend:`);
  console.log(`TRASH = ${trashAddress}`);
  console.log(`────────────────────────────────────────────`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
