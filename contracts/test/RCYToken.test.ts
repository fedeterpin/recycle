import { expect } from "chai";
import { ethers } from "hardhat";
import { RCYToken } from "../typechain-types";

type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

describe("RCYToken", () => {
  let rcy: RCYToken;
  let admin: Signer;
  let burner: Signer;
  let user: Signer;

  const TOTAL_SUPPLY = ethers.parseEther("1000000000"); // 1 billion

  beforeEach(async () => {
    [admin, burner, user] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("RCYToken");
    rcy = (await Factory.deploy(admin.address)) as unknown as RCYToken;
  });

  it("has correct name and symbol", async () => {
    expect(await rcy.name()).to.equal("Recycle Token");
    expect(await rcy.symbol()).to.equal("RCY");
  });

  it("has total supply of 1 billion RCY", async () => {
    expect(await rcy.totalSupply()).to.equal(TOTAL_SUPPLY);
  });

  it("mints entire supply to admin on deploy", async () => {
    expect(await rcy.balanceOf(admin.address)).to.equal(TOTAL_SUPPLY);
  });

  it("admin can grant BURNER_ROLE", async () => {
    const BURNER_ROLE = await rcy.BURNER_ROLE();
    await rcy.connect(admin).grantRole(BURNER_ROLE, burner.address);
    expect(await rcy.hasRole(BURNER_ROLE, burner.address)).to.be.true;
  });

  it("account with BURNER_ROLE can burn tokens from any address", async () => {
    const BURNER_ROLE = await rcy.BURNER_ROLE();
    await rcy.connect(admin).grantRole(BURNER_ROLE, burner.address);

    // Give user some tokens
    await rcy.connect(admin).transfer(user.address, ethers.parseEther("100"));

    await rcy.connect(burner).burn(user.address, ethers.parseEther("40"));
    expect(await rcy.balanceOf(user.address)).to.equal(ethers.parseEther("60"));
  });

  it("account without BURNER_ROLE cannot burn tokens", async () => {
    await rcy.connect(admin).transfer(user.address, ethers.parseEther("100"));
    await expect(
      rcy.connect(user).burn(user.address, ethers.parseEther("50"))
    ).to.be.reverted;
  });
});
