/**
 * compactor-smoke.ts — end-to-end smoke test against a running local node
 * with already-deployed contracts. Reads addresses from deployments/localhost.json.
 *
 *   - Deploys a fresh MockERC20
 *   - Sets a 1:1 swap rate on the MockPancakeRouter
 *   - User (account 1) deposits 100 tokens
 *   - Executor (account 0) calls executeBatch
 *   - User claims BNB
 *   - User deposits 50 tokens into the next batch, executor failBatch's it,
 *     user redeems
 */
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const deploymentsPath = path.join(__dirname, "..", "deployments", "localhost.json");
  const d = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8")) as {
    contracts: Record<string, string>;
  };

  const [executor, user] = await ethers.getSigners();

  const compactor = await ethers.getContractAt("Compactor", d.contracts.Compactor);
  const receipt = await ethers.getContractAt(
    "RCYFractionalReceipt",
    d.contracts.RCYFractionalReceipt,
  );
  const router = await ethers.getContractAt(
    "MockPancakeRouter",
    d.contracts.MockPancakeRouter,
  );

  // Fresh dust token
  const Mock = await ethers.getContractFactory("MockERC20");
  const token = await Mock.deploy();
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`MockERC20 deployed at ${tokenAddr}`);

  // 1:1 rate
  await router.setRate(tokenAddr, ethers.parseEther("1"));

  // ── Happy path ───────────────────────────────────────────────────────────
  const amount = ethers.parseEther("100");
  await token.mint(user.address, amount);
  await token.connect(user).approve(d.contracts.Compactor, amount);

  console.log("[user] depositDust(100)");
  const txDep = await compactor.connect(user).depositDust(tokenAddr, amount);
  await txDep.wait();

  const batchIdBefore = await compactor.currentBatchId(tokenAddr);
  console.log(`current batch for token: ${batchIdBefore}`);

  console.log("[executor] executeBatch");
  const txExec = await compactor.connect(executor).executeBatch(tokenAddr, 1n);
  await txExec.wait();

  const batchIdAfter = await compactor.currentBatchId(tokenAddr);
  console.log(`current batch advanced to: ${batchIdAfter}`);

  console.log("[user] claimBNB");
  const balBefore = await ethers.provider.getBalance(user.address);
  const txClaim = await compactor.connect(user).claimBNB(tokenAddr, 0, amount);
  const recClaim = await txClaim.wait();
  const balAfter = await ethers.provider.getBalance(user.address);
  const gas = recClaim!.gasUsed * recClaim!.gasPrice;
  console.log(`BNB claimed: ${ethers.formatEther(balAfter + gas - balBefore)} BNB`);

  // ── Fail path ────────────────────────────────────────────────────────────
  const amount2 = ethers.parseEther("50");
  await token.mint(user.address, amount2);
  await token.connect(user).approve(d.contracts.Compactor, amount2);
  console.log("[user] depositDust(50) into next batch");
  await (await compactor.connect(user).depositDust(tokenAddr, amount2)).wait();

  console.log("[executor] failBatch");
  await (await compactor.connect(executor).failBatch(tokenAddr, 1)).wait();

  console.log("[user] redeemDust");
  await (await compactor.connect(user).redeemDust(tokenAddr, 1, amount2)).wait();
  const tokenBal = await token.balanceOf(user.address);
  console.log(`Tokens recovered: ${ethers.formatEther(tokenBal)}`);

  console.log("\n✅ Smoke test complete. Watch the backend logs for indexer output.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
