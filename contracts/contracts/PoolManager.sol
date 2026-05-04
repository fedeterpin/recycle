// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Vault.sol";

// ── External interfaces ────────────────────────────────────────────────────────

interface IPancakeV2Router {
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

    function WETH() external pure returns (address);
}

/// @title PoolManager — Sells token vaults and distributes BNB proceeds
/// @notice Called manually by the Multisig when it considers the vault ready to sell.
///         Withdraws a token from the Vault, sells it on PancakeSwap V2, then
///         distributes the BNB proceeds according to configurable splits:
///
///         - buybackBps  → BuybackBurner (compra y quema $RCY)
///         - holdersBps  → holders reward wallet
///         - devBps      → treasury (desarrollo & equipo)
///         - marketingBps→ marketing wallet
///
///         All basis points must sum to 10,000.
contract PoolManager is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    // ── State ─────────────────────────────────────────────────────────────────

    /// @dev PancakeSwap V2 Router — hardcoded to prevent phishing
    address public constant DEX_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address public constant DEAD       = 0x000000000000000000000000000000000000dEaD;

    Vault public immutable vault;

    address payable public buybackBurner;
    address payable public holdersWallet;
    address payable public devWallet;
    address payable public marketingWallet;

    /// @notice Fee split in basis points (must sum to 10,000)
    uint256 public buybackBps   = 5000; // 50%
    uint256 public holdersBps   = 2500; // 25%
    uint256 public devBps       = 1500; // 15%
    uint256 public marketingBps = 1000; // 10%

    // ── Events ────────────────────────────────────────────────────────────────

    event VaultSold(
        address indexed token,
        uint256 tokenAmount,
        uint256 bnbReceived
    );
    event BnbDistributed(
        uint256 buyback,
        uint256 holders,
        uint256 dev,
        uint256 marketing
    );
    event TokenBurned(address indexed token, uint256 amount);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address _vault,
        address payable _buybackBurner,
        address payable _holdersWallet,
        address payable _devWallet,
        address payable _marketingWallet,
        address admin
    ) {
        vault          = Vault(_vault);
        buybackBurner  = _buybackBurner;
        holdersWallet  = _holdersWallet;
        devWallet      = _devWallet;
        marketingWallet = _marketingWallet;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(EXECUTOR_ROLE, admin);
    }

    // ── Core logic ────────────────────────────────────────────────────────────

    /// @notice Sell the entire vault balance of `token` and distribute BNB proceeds.
    /// @param token       ERC-20 token to sell
    /// @param minAmountOut Minimum BNB to receive (slippage protection)
    function sellVault(address token, uint256 minAmountOut)
        external
        nonReentrant
        onlyRole(EXECUTOR_ROLE)
    {
        uint256 amount = vault.getBalance(token);
        require(amount > 0, "PoolManager: vault empty");

        // Withdraw tokens from Vault to this contract
        vault.release(token, address(this), amount);

        // Approve router and attempt swap
        IERC20(token).forceApprove(DEX_ROUTER, amount);

        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = IPancakeV2Router(DEX_ROUTER).WETH();

        uint256 balanceBefore = address(this).balance;

        try IPancakeV2Router(DEX_ROUTER)
            .swapExactTokensForETHSupportingFeeOnTransferTokens(
                amount,
                minAmountOut,
                path,
                address(this),
                block.timestamp + 300
            )
        {
            uint256 bnbReceived = address(this).balance - balanceBefore;
            emit VaultSold(token, amount, bnbReceived);
            _distribute(bnbReceived);
        } catch {
            // Token has no liquid market — burn it to the dead address
            IERC20(token).forceApprove(DEX_ROUTER, 0);
            IERC20(token).safeTransfer(DEAD, amount);
            emit TokenBurned(token, amount);
        }
    }

    /// @dev Distributes BNB proceeds according to configured splits.
    function _distribute(uint256 total) internal {
        if (total == 0) return;

        uint256 buyback   = (total * buybackBps)   / 10_000;
        uint256 holders   = (total * holdersBps)   / 10_000;
        uint256 dev       = (total * devBps)        / 10_000;
        uint256 marketing = total - buyback - holders - dev; // remainder avoids rounding loss

        _sendBnb(buybackBurner,  buyback);
        _sendBnb(holdersWallet,  holders);
        _sendBnb(devWallet,      dev);
        _sendBnb(marketingWallet, marketing);

        emit BnbDistributed(buyback, holders, dev, marketing);
    }

    function _sendBnb(address payable to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "PoolManager: BNB transfer failed");
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// @notice Update BNB distribution splits. Must sum to 10,000 bps.
    function setSplits(
        uint256 _buybackBps,
        uint256 _holdersBps,
        uint256 _devBps,
        uint256 _marketingBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            _buybackBps + _holdersBps + _devBps + _marketingBps == 10_000,
            "PoolManager: splits must sum to 10000"
        );
        buybackBps   = _buybackBps;
        holdersBps   = _holdersBps;
        devBps       = _devBps;
        marketingBps = _marketingBps;
    }

    function setBuybackBurner(address payable _addr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        buybackBurner = _addr;
    }

    function setHoldersWallet(address payable _addr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        holdersWallet = _addr;
    }

    function setDevWallet(address payable _addr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        devWallet = _addr;
    }

    function setMarketingWallet(address payable _addr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        marketingWallet = _addr;
    }

    receive() external payable {}
}
