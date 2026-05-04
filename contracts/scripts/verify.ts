import { run, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const deploymentsPath = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`No deployments found for network: ${network.name}`);
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const { contracts, deployer } = deployments;

  console.log(`Verifying contracts on ${network.name}...`);

  await run("verify:verify", {
    address: contracts.RCYToken,
    constructorArguments: [deployer],
  });

  await run("verify:verify", {
    address: contracts.Incinerator,
    constructorArguments: [
      contracts.RCYToken,
      process.env.TREASURY_ADDRESS || deployer,
      process.env.FLAT_FEE || "1000000000000000",
      process.env.RCY_PER_BURN || "100000000000000000000",
    ],
  });

  await run("verify:verify", {
    address: contracts.Compactor,
    constructorArguments: [
      contracts.RCYToken,
      process.env.TREASURY_ADDRESS || deployer,
      300,
    ],
  });

  await run("verify:verify", {
    address: contracts.ScrapMarket,
    constructorArguments: [
      contracts.RCYToken,
      contracts.Compactor,
      process.env.TREASURY_ADDRESS || deployer,
      200,
    ],
  });

  console.log("✅ All contracts verified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
