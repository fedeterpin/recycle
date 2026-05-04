// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Vault — Per-token custody for the Recycle Protocol
/// @notice Holds tokens deposited via the Incinerator until the PoolManager sells them.
///         Each token type has its own logical vault tracked by its ERC-20 balance.
///         Deposits are made by transferring tokens directly to this contract's address;
///         the Incinerator is responsible for the transfer. Withdrawals require MANAGER_ROLE.
contract Vault is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    event TokenReleased(address indexed token, address indexed to, uint256 amount);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Release tokens to a recipient. Only callable by PoolManager.
    function release(address token, address to, uint256 amount) external onlyRole(MANAGER_ROLE) {
        IERC20(token).safeTransfer(to, amount);
        emit TokenReleased(token, to, amount);
    }

    /// @notice Returns the vault balance for a given token.
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
