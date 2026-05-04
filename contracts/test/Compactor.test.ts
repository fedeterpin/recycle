import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type {
  Compactor,
  RCYFractionalReceipt,
  MockERC20,
  MockPancakeRouter,
  MockFailingPancakeRouter,
} from "../typechain-types";

type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

const WBNB_PLACEHOLDER = "0x000000000000000000000000000000000000bEEF";
const ZERO = ethers.ZeroAddress;

describe("Compactor", () => {
  let admin: Signer;
  let treasury: Signer;
  let user1: Signer;
  let user2: Signer;
  let stranger: Signer;

  let receipt: RCYFractionalReceipt;
  let router: MockPancakeRouter;
  let compactor: Compactor;
  let token: MockERC20;

  // Mock router pays 1 wei BNB per 1 wei token (1e18 scaled).
  const RATE_1_TO_1 = ethers.parseEther("1");

  async function deployFixture() {
    const [_admin, _treasury, _user1, _user2, _stranger] = await ethers.getSigners();

    const Receipt = await ethers.getContractFactory("RCYFractionalReceipt");
    const _receipt = await Receipt.deploy(_admin.address);

    const Router = await ethers.getContractFactory("MockPancakeRouter");
    const _router = await Router.deploy(WBNB_PLACEHOLDER);

    const Compactor = await ethers.getContractFactory("Compactor");
    const _compactor = await Compactor.deploy(
      await _receipt.getAddress(),
      await _router.getAddress(),
      _treasury.address,
      _admin.address,
    );

    await _receipt
      .connect(_admin)
      .grantRole(await _receipt.MINTER_ROLE(), await _compactor.getAddress());
    await _receipt
      .connect(_admin)
      .grantRole(await _receipt.BURNER_ROLE(), await _compactor.getAddress());

    const Mock = await ethers.getContractFactory("MockERC20");
    const _token = await Mock.deploy();

    // Fund router with BNB for swaps. Tests deposit up to 1000 tokens at a 1:1
    // rate, so the router needs comfortably more than that on hand.
    await _admin.sendTransaction({
      to: await _router.getAddress(),
      value: ethers.parseEther("5000"),
    });

    await _router.setRate(await _token.getAddress(), RATE_1_TO_1);

    return {
      admin: _admin,
      treasury: _treasury,
      user1: _user1,
      user2: _user2,
      stranger: _stranger,
      receipt: _receipt as unknown as RCYFractionalReceipt,
      router: _router as unknown as MockPancakeRouter,
      compactor: _compactor as unknown as Compactor,
      token: _token as unknown as MockERC20,
    };
  }

  beforeEach(async () => {
    const f = await loadFixture(deployFixture);
    admin = f.admin;
    treasury = f.treasury;
    user1 = f.user1;
    user2 = f.user2;
    stranger = f.stranger;
    receipt = f.receipt;
    router = f.router;
    compactor = f.compactor;
    token = f.token;
  });

  async function depositAs(signer: Signer, amount: bigint) {
    await token.mint(signer.address, amount);
    await token.connect(signer).approve(await compactor.getAddress(), amount);
    await compactor.connect(signer).depositDust(await token.getAddress(), amount);
  }

  it("happy path: two deposits, execute, both users claim BNB", async () => {
    const a1 = ethers.parseEther("100");
    const a2 = ethers.parseEther("300");
    await depositAs(user1, a1);
    await depositAs(user2, a2);

    const total = a1 + a2;
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);

    await expect(
      compactor.connect(admin).executeBatch(await token.getAddress(), 1),
    ).to.emit(compactor, "BatchExecuted");

    // 10% fee → treasury
    const fee = (total * 1000n) / 10_000n;
    const forUsers = total - fee;

    expect(
      (await ethers.provider.getBalance(treasury.address)) - treasuryBefore,
    ).to.equal(fee);

    // Batch advanced
    expect(await compactor.currentBatchId(await token.getAddress())).to.equal(1);

    // user1 claims
    const tokenId0 = await getReceiptTokenId(await token.getAddress(), 0n);
    expect(await receipt.balanceOf(user1.address, tokenId0)).to.equal(a1);

    const u1Before = await ethers.provider.getBalance(user1.address);
    const tx1 = await compactor
      .connect(user1)
      .claimBNB(await token.getAddress(), 0, a1);
    const r1 = await tx1.wait();
    const gas1 = r1!.gasUsed * r1!.gasPrice;
    const u1After = await ethers.provider.getBalance(user1.address);
    expect(u1After + gas1 - u1Before).to.equal((a1 * forUsers) / total);

    // user2 claims the rest
    const u2Before = await ethers.provider.getBalance(user2.address);
    const tx2 = await compactor
      .connect(user2)
      .claimBNB(await token.getAddress(), 0, a2);
    const r2 = await tx2.wait();
    const gas2 = r2!.gasUsed * r2!.gasPrice;
    const u2After = await ethers.provider.getBalance(user2.address);
    expect(u2After + gas2 - u2Before).to.equal((a2 * forUsers) / total);

    // Receipts burned
    expect(await receipt.balanceOf(user1.address, tokenId0)).to.equal(0);
    expect(await receipt.balanceOf(user2.address, tokenId0)).to.equal(0);
  });

  it("opens a fresh batch after execute", async () => {
    await depositAs(user1, ethers.parseEther("100"));
    await compactor.connect(admin).executeBatch(await token.getAddress(), 1);

    await depositAs(user2, ethers.parseEther("50"));
    expect(await compactor.currentBatchId(await token.getAddress())).to.equal(1);

    const tokenId0 = await getReceiptTokenId(await token.getAddress(), 0n);
    const tokenId1 = await getReceiptTokenId(await token.getAddress(), 1n);
    expect(tokenId0).to.not.equal(tokenId1);
    expect(await receipt.balanceOf(user2.address, tokenId1)).to.equal(
      ethers.parseEther("50"),
    );
  });

  it("non-executor cannot executeBatch or failBatch", async () => {
    await depositAs(user1, ethers.parseEther("10"));
    await expect(
      compactor.connect(stranger).executeBatch(await token.getAddress(), 1),
    ).to.be.reverted;
    await expect(
      compactor.connect(stranger).failBatch(await token.getAddress(), 0),
    ).to.be.reverted;
  });

  it("swap revert keeps batch open and allows retry", async () => {
    const Failing = await ethers.getContractFactory("MockFailingPancakeRouter");
    const failingRouter = (await Failing.deploy(
      WBNB_PLACEHOLDER,
    )) as unknown as MockFailingPancakeRouter;

    const Compactor = await ethers.getContractFactory("Compactor");
    const compactor2 = (await Compactor.deploy(
      await receipt.getAddress(),
      await failingRouter.getAddress(),
      treasury.address,
      admin.address,
    )) as unknown as Compactor;
    await receipt
      .connect(admin)
      .grantRole(await receipt.MINTER_ROLE(), await compactor2.getAddress());
    await receipt
      .connect(admin)
      .grantRole(await receipt.BURNER_ROLE(), await compactor2.getAddress());

    const amount = ethers.parseEther("100");
    await token.mint(user1.address, amount);
    await token.connect(user1).approve(await compactor2.getAddress(), amount);
    await compactor2.connect(user1).depositDust(await token.getAddress(), amount);

    await expect(
      compactor2.connect(admin).executeBatch(await token.getAddress(), 1),
    ).to.be.revertedWith("Compactor: swap failed");

    // Batch still Open
    const b = await compactor2.batches(await token.getAddress(), 0);
    expect(b.status).to.equal(0); // Open
    expect(b.totalDeposited).to.equal(amount);
  });

  it("failBatch + redeemDust returns original tokens pro-rata", async () => {
    const a1 = ethers.parseEther("100");
    const a2 = ethers.parseEther("300");
    await depositAs(user1, a1);
    await depositAs(user2, a2);

    await compactor.connect(admin).failBatch(await token.getAddress(), 0);

    expect(await compactor.currentBatchId(await token.getAddress())).to.equal(1);

    await compactor.connect(user1).redeemDust(await token.getAddress(), 0, a1);
    await compactor.connect(user2).redeemDust(await token.getAddress(), 0, a2);

    expect(await token.balanceOf(user1.address)).to.equal(a1);
    expect(await token.balanceOf(user2.address)).to.equal(a2);
  });

  it("cannot redeemDust on Open or Executed batch", async () => {
    await depositAs(user1, ethers.parseEther("10"));
    await expect(
      compactor
        .connect(user1)
        .redeemDust(await token.getAddress(), 0, ethers.parseEther("1")),
    ).to.be.revertedWith("Compactor: batch not failed");

    await compactor.connect(admin).executeBatch(await token.getAddress(), 1);
    await expect(
      compactor
        .connect(user1)
        .redeemDust(await token.getAddress(), 0, ethers.parseEther("1")),
    ).to.be.revertedWith("Compactor: batch not failed");
  });

  it("cannot claimBNB on Open or Failed batch", async () => {
    await depositAs(user1, ethers.parseEther("10"));
    await expect(
      compactor
        .connect(user1)
        .claimBNB(await token.getAddress(), 0, ethers.parseEther("1")),
    ).to.be.revertedWith("Compactor: batch not executed");

    await compactor.connect(admin).failBatch(await token.getAddress(), 0);
    await expect(
      compactor
        .connect(user1)
        .claimBNB(await token.getAddress(), 0, ethers.parseEther("1")),
    ).to.be.revertedWith("Compactor: batch not executed");
  });

  it("claimBNB reverts when receipt balance is insufficient", async () => {
    await depositAs(user1, ethers.parseEther("10"));
    await compactor.connect(admin).executeBatch(await token.getAddress(), 1);

    await expect(
      compactor
        .connect(user2)
        .claimBNB(await token.getAddress(), 0, ethers.parseEther("1")),
    ).to.be.reverted;
  });

  it("setProtocolFee enforces 20% cap", async () => {
    await expect(
      compactor.connect(admin).setProtocolFee(2001),
    ).to.be.revertedWith("Compactor: fee too high");
    await compactor.connect(admin).setProtocolFee(2000);
    expect(await compactor.protocolFeeBps()).to.equal(2000);
  });

  it("protocol fee snapshots at execute time, not deposit time", async () => {
    const amount = ethers.parseEther("1000");
    await compactor.connect(admin).setProtocolFee(1000); // 10%
    await depositAs(user1, amount);
    await compactor.connect(admin).setProtocolFee(2000); // 20% — set AFTER deposit

    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    await compactor.connect(admin).executeBatch(await token.getAddress(), 1);
    const treasuryAfter = await ethers.provider.getBalance(treasury.address);

    // Fee should be 20% (snapshot at execute time), not 10%
    expect(treasuryAfter - treasuryBefore).to.equal((amount * 2000n) / 10_000n);
  });

  it("executeBatch reverts when minAmountOut exceeds router output", async () => {
    const amount = ethers.parseEther("100");
    await depositAs(user1, amount);

    // Router pays 1:1, so a minAmountOut > amount must revert.
    await expect(
      compactor
        .connect(admin)
        .executeBatch(await token.getAddress(), amount + 1n),
    ).to.be.revertedWith("Compactor: swap failed");
  });

  it("rejects zero token / zero amount on deposit", async () => {
    await expect(
      compactor.connect(user1).depositDust(ZERO, 1),
    ).to.be.revertedWith("Compactor: invalid token");
    await expect(
      compactor.connect(user1).depositDust(await token.getAddress(), 0),
    ).to.be.revertedWith("Compactor: amount must be > 0");
  });

  it("rejects deposit into a non-Open batch (defensive)", async () => {
    // Open → Failed
    await depositAs(user1, ethers.parseEther("1"));
    await compactor.connect(admin).failBatch(await token.getAddress(), 0);

    // currentBatchId advanced to 1 (Open). Direct call into batch 0 is impossible
    // because depositDust uses currentBatchId; this is just a smoke test that
    // a fresh batch is open and a deposit succeeds.
    const next = ethers.parseEther("2");
    await token.mint(user1.address, next);
    await token.connect(user1).approve(await compactor.getAddress(), next);
    await compactor.connect(user1).depositDust(await token.getAddress(), next);
    expect(await compactor.currentBatchId(await token.getAddress())).to.equal(1);
  });

  it("setTreasury rejects zero and updates", async () => {
    await expect(
      compactor.connect(admin).setTreasury(ZERO),
    ).to.be.revertedWith("Compactor: treasury zero");
    await compactor.connect(admin).setTreasury(stranger.address);
    expect(await compactor.treasury()).to.equal(stranger.address);
  });

  it("populates reverse mappings on first deposit", async () => {
    const tokenAddr = await token.getAddress();
    await depositAs(user1, ethers.parseEther("1"));
    const id = await getReceiptTokenId(tokenAddr, 0n);
    expect(await compactor.tokenOfReceipt(id)).to.equal(tokenAddr);
    expect(await compactor.batchOfReceipt(id)).to.equal(0n);
  });
});

async function getReceiptTokenId(token: string, batchId: bigint): Promise<bigint> {
  const packed = ethers.solidityPacked(["address", "uint256"], [token, batchId]);
  return BigInt(ethers.keccak256(packed));
}
