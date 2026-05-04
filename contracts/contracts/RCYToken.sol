// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title RCY Token — Recycle Protocol native token
/// @notice Fixed supply of 1,000,000,000 RCY minted at deploy to the admin.
///         BURNER_ROLE is granted exclusively to BuybackBurner to reduce circulating supply.
contract RCYToken is ERC20, AccessControl {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;

    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    constructor(address admin) ERC20("Recycle Token", "RCY") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _mint(admin, TOTAL_SUPPLY);
    }

    /// @notice Burn tokens from an account. Only callable by BuybackBurner.
    function burn(address from, uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(from, amount);
    }
}
