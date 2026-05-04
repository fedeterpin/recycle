// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./RCYToken.sol";

// ── External interfaces ────────────────────────────────────────────────────────

interface IPancakeV2Router {
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;

    function WETH() external pure returns (address);
}

/// @title BuybackBurner — Buys $RCY with BNB and burns it
/// @notice Receives BNB from PoolManager, buys $RCY on PancakeSwap V2,
///         and burns the purchased tokens via RCYToken.burn().
///         This is the deflation engine of the protocol:
///         every vault sale reduces the circulating supply of $RCY.
contract BuybackBurner is AccessControl, ReentrancyGuard {

    // ── State ─────────────────────────────────────────────────────────────────

    /// @notice Role granted to contracts allowed to trigger a buyback (PoolManager).
    bytes32 public constant CALLER_ROLE = keccak256("CALLER_ROLE");

    /// @dev PancakeSwap V2 Router — hardcoded to prevent phishing
    address public constant DEX_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;

    RCYToken public immutable rcy;

    uint256 public totalBurned;

    // ── Events ────────────────────────────────────────────────────────────────

    event BuybackExecuted(uint256 bnbIn, uint256 rcyBurned);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _rcy, address admin) {
        rcy = RCYToken(_rcy);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ── Core logic ────────────────────────────────────────────────────────────

    /// @notice Buy $RCY with all BNB held by this contract and burn it.
    /// @param minRcyOut Minimum $RCY to receive (slippage protection).
    function executeBuyback(uint256 minRcyOut) external nonReentrant onlyRole(CALLER_ROLE) {
        uint256 bnbBalance = address(this).balance;
        require(bnbBalance > 0, "BuybackBurner: no BNB");

        address[] memory path = new address[](2);
        path[0] = IPancakeV2Router(DEX_ROUTER).WETH();
        path[1] = address(rcy);

        uint256 rcyBefore = rcy.balanceOf(address(this));

        IPancakeV2Router(DEX_ROUTER)
            .swapExactETHForTokensSupportingFeeOnTransferTokens{value: bnbBalance}(
                minRcyOut,
                path,
                address(this),
                block.timestamp + 300
            );

        uint256 rcyBought = rcy.balanceOf(address(this)) - rcyBefore;
        require(rcyBought > 0, "BuybackBurner: no RCY bought");

        rcy.burn(address(this), rcyBought);
        totalBurned += rcyBought;

        emit BuybackExecuted(bnbBalance, rcyBought);
    }

    /// @notice Accepts BNB from PoolManager.
    receive() external payable {}
}
