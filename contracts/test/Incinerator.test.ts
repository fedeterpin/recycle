import { expect } from "chai";
import { ethers } from "hardhat";
import type {
  RCYToken,
  Incinerator,
  Vault,
  TaxLossCertificate,
  MockERC20,
  MockHoneypotERC20,
  MockPriceOracle,
} from "../typechain-types";

type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

describe("Incinerator", () => {
  let rcy: RCYToken;
  let vault: Vault;
  let certificate: TaxLossCertificate;
  let incinerator: Incinerator;
  let admin: Signer;
  let treasury: Signer;
  let user: Signer;

  const FLAT_FEE = ethers.parseEther("0.001");
  const MIN_REWARD = ethers.parseEther("10");
  const REWARD_K = ethers.parseEther("100");
  const REWARDS_POOL = ethers.parseEther("340000000"); // 340M RCY sent to Incinerator

  beforeEach(async () => {
    [admin, treasury, user] = await ethers.getSigners();

    // Deploy RCY token
    const RCY = await ethers.getContractFactory("RCYToken");
    rcy = (await RCY.deploy(admin.address)) as unknown as RCYToken;

    // Deploy Vault
    const VaultFactory = await ethers.getContractFactory("Vault");
    vault = (await VaultFactory.deploy(admin.address)) as unknown as Vault;

    // Deploy MockPriceOracle
    const OracleFactory = await ethers.getContractFactory("MockPriceOracle");
    const oracle = (await OracleFactory.deploy()) as unknown as MockPriceOracle;

    // Deploy TaxLossCertificate
    const CertFactory = await ethers.getContractFactory("TaxLossCertificate");
    certificate = (await CertFactory.deploy(
      admin.address,
    )) as unknown as TaxLossCertificate;

    // Deploy Incinerator
    const Inc = await ethers.getContractFactory("Incinerator");
    incinerator = (await Inc.deploy(
      await rcy.getAddress(),
      await vault.getAddress(),
      await oracle.getAddress(),
      await certificate.getAddress(),
      treasury.address,
      FLAT_FEE,
      MIN_REWARD,
      REWARD_K,
    )) as unknown as Incinerator;

    // Grant Incinerator MINTER_ROLE on TaxLossCertificate
    const MINTER_ROLE = await certificate.MINTER_ROLE();
    await certificate
      .connect(admin)
      .grantRole(MINTER_ROLE, await incinerator.getAddress());

    // Fund Incinerator with rewards pool (admin transfers 340M RCY)
    await rcy
      .connect(admin)
      .transfer(await incinerator.getAddress(), REWARDS_POOL);
  });

  it("reverts if fee is insufficient", async () => {
    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = (await MockToken.deploy()) as unknown as MockERC20;

    await expect(
      incinerator
        .connect(user)
        .burn(await token.getAddress(), ethers.parseEther("100"), {
          value: ethers.parseEther("0.0001"),
        }),
    ).to.be.revertedWith("Incinerator: insufficient fee");
  });

  it("emits Burned and sends RCY from rewards pool on successful burn", async () => {
    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = (await MockToken.deploy()) as unknown as MockERC20;

    const amount = ethers.parseEther("1000");
    await token.mint(user.address, amount);
    await token.connect(user).approve(await incinerator.getAddress(), amount);

    const balanceBefore = await rcy.balanceOf(user.address);

    await expect(
      incinerator
        .connect(user)
        .burn(await token.getAddress(), amount, { value: FLAT_FEE }),
    ).to.emit(incinerator, "LogBurn");

    expect(await rcy.balanceOf(user.address)).to.be.gte(
      balanceBefore + MIN_REWARD,
    );
  });

  it("token without price gets exactly minReward", async () => {
    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = (await MockToken.deploy()) as unknown as MockERC20;

    const amount = ethers.parseEther("500");
    await token.mint(user.address, amount);
    await token.connect(user).approve(await incinerator.getAddress(), amount);

    await incinerator
      .connect(user)
      .burn(await token.getAddress(), amount, { value: FLAT_FEE });

    expect(await rcy.balanceOf(user.address)).to.equal(MIN_REWARD);
  });

  it("emits LogBurnFailed but does not revert on honeypot token", async () => {
    const HoneypotToken = await ethers.getContractFactory("MockHoneypotERC20");
    const honeypot =
      (await HoneypotToken.deploy()) as unknown as MockHoneypotERC20;

    await expect(
      incinerator
        .connect(user)
        .burn(await honeypot.getAddress(), ethers.parseEther("100"), {
          value: FLAT_FEE,
        }),
    ).to.emit(incinerator, "LogBurnFailed");
  });

  it("refunds the full fee to the user when the burn fails (honeypot)", async () => {
    const HoneypotToken = await ethers.getContractFactory("MockHoneypotERC20");
    const honeypot =
      (await HoneypotToken.deploy()) as unknown as MockHoneypotERC20;

    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const userBefore = await ethers.provider.getBalance(user.address);

    const tx = await incinerator
      .connect(user)
      .burn(await honeypot.getAddress(), ethers.parseEther("100"), {
        value: FLAT_FEE,
      });
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;

    // Treasury must not receive the fee on a failed burn.
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore);

    // User's only cost should be gas — the BNB fee is refunded.
    const userAfter = await ethers.provider.getBalance(user.address);
    expect(userBefore - userAfter).to.equal(gasCost);
  });

  it("refunds excess BNB above the flat fee on a successful burn", async () => {
    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = (await MockToken.deploy()) as unknown as MockERC20;

    const amount = ethers.parseEther("100");
    await token.mint(user.address, amount);
    await token.connect(user).approve(await incinerator.getAddress(), amount);

    const overpay = FLAT_FEE * 5n;
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);

    await incinerator
      .connect(user)
      .burn(await token.getAddress(), amount, { value: overpay });

    // Only the flatFee reaches the treasury — overpay is refunded to the user.
    expect(
      (await ethers.provider.getBalance(treasury.address)) - treasuryBefore,
    ).to.equal(FLAT_FEE);
  });

  it("forwards flat fee to treasury", async () => {
    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = (await MockToken.deploy()) as unknown as MockERC20;

    const amount = ethers.parseEther("100");
    await token.mint(user.address, amount);
    await token.connect(user).approve(await incinerator.getAddress(), amount);

    const before = await ethers.provider.getBalance(treasury.address);
    await incinerator
      .connect(user)
      .burn(await token.getAddress(), amount, { value: FLAT_FEE });
    const after = await ethers.provider.getBalance(treasury.address);

    expect(after - before).to.equal(FLAT_FEE);
  });

  it("sends burned tokens to Vault (not to dead address)", async () => {
    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = (await MockToken.deploy()) as unknown as MockERC20;

    const amount = ethers.parseEther("1000");
    await token.mint(user.address, amount);
    await token.connect(user).approve(await incinerator.getAddress(), amount);

    await incinerator
      .connect(user)
      .burn(await token.getAddress(), amount, { value: FLAT_FEE });

    expect(await vault.getBalance(await token.getAddress())).to.equal(amount);
  });

  it("mints a TaxLossCertificate NFT to the user", async () => {
    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = (await MockToken.deploy()) as unknown as MockERC20;

    const amount = ethers.parseEther("200");
    await token.mint(user.address, amount);
    await token.connect(user).approve(await incinerator.getAddress(), amount);

    await incinerator
      .connect(user)
      .burn(await token.getAddress(), amount, { value: FLAT_FEE });

    expect(await certificate.balanceOf(user.address)).to.equal(1);
    expect(await certificate.ownerOf(1)).to.equal(user.address);
  });

  it("reward is capped when pool is nearly exhausted", async () => {
    const leftover = ethers.parseEther("5");

    const OracleFactory = await ethers.getContractFactory("MockPriceOracle");
    const oracle2 = (await OracleFactory.deploy()) as unknown as MockPriceOracle;
    const Inc2 = await ethers.getContractFactory("Incinerator");
    const inc2 = (await Inc2.deploy(
      await rcy.getAddress(),
      await vault.getAddress(),
      await oracle2.getAddress(),
      await certificate.getAddress(),
      treasury.address,
      FLAT_FEE,
      MIN_REWARD,
      REWARD_K,
    )) as unknown as Incinerator;

    const MINTER_ROLE = await certificate.MINTER_ROLE();
    await certificate
      .connect(admin)
      .grantRole(MINTER_ROLE, await inc2.getAddress());

    // Fund with only 5 RCY (less than minReward=10)
    await rcy.connect(admin).transfer(await inc2.getAddress(), leftover);

    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = (await MockToken.deploy()) as unknown as MockERC20;
    await token.mint(user.address, ethers.parseEther("100"));
    await token
      .connect(user)
      .approve(await inc2.getAddress(), ethers.parseEther("100"));

    const balBefore = await rcy.balanceOf(user.address);
    await inc2
      .connect(user)
      .burn(await token.getAddress(), ethers.parseEther("100"), {
        value: FLAT_FEE,
      });
    const balAfter = await rcy.balanceOf(user.address);

    // Should receive at most leftover (5 RCY), not the full minReward (10 RCY)
    expect(balAfter - balBefore).to.equal(leftover);
  });
});
