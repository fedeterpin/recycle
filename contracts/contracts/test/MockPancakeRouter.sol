// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Test-only PancakeSwap V2 router stub. Pulls `amountIn` of the input
///      token from the caller and sends back BNB at a configurable rate per
///      token (in wei of BNB per wei of token, 1e18-scaled).
contract MockPancakeRouter {
    using SafeERC20 for IERC20;

    address public immutable wbnb;
    mapping(address => uint256) public rate; // bnbWei per tokenWei, scaled by 1e18

    constructor(address _wbnb) {
        wbnb = _wbnb;
    }

    function setRate(address token, uint256 bnbWeiPerTokenScaled1e18) external {
        rate[token] = bnbWeiPerTokenScaled1e18;
    }

    function WETH() external view returns (address) {
        return wbnb;
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external {
        require(path.length >= 2, "MockRouter: bad path");
        address tokenIn = path[0];
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 out = (amountIn * rate[tokenIn]) / 1e18;
        require(out >= amountOutMin, "MockRouter: insufficient output");

        (bool ok, ) = to.call{value: out}("");
        require(ok, "MockRouter: BNB send failed");
    }

    receive() external payable {}
}

/// @dev Test-only router that always reverts on swap.
contract MockFailingPancakeRouter {
    address public immutable wbnb;

    constructor(address _wbnb) {
        wbnb = _wbnb;
    }

    function WETH() external view returns (address) {
        return wbnb;
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256,
        uint256,
        address[] calldata,
        address,
        uint256
    ) external pure {
        revert("MockRouter: forced failure");
    }

    receive() external payable {}
}
