// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Used only in tests. Never deploy to production.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Simulates a honeypot that always reverts on transferFrom
contract MockHoneypotERC20 is ERC20 {
    constructor() ERC20("Honeypot", "HONEY") {}

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert("honeypot: transfer blocked");
    }
}

/// @dev Minimal price oracle mock — returns a configurable USD value for any token.
contract MockPriceOracle {
    uint256 private _usdValue;

    function setUsdValue(uint256 value) external {
        _usdValue = value;
    }

    function getUsdValue(address, uint256) external view returns (uint256) {
        return _usdValue;
    }
}
