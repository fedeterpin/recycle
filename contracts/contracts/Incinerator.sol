// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./RCYToken.sol";
import "./Vault.sol";
import "./PriceOracle.sol";
import "./TaxLossCertificate.sol";

/// @title Incinerator — Burns trash tokens and rewards users with $RCY
/// @notice Users pay a flat BNB fee, deposit any ERC-20, and receive:
///         1. $RCY from the pre-funded rewards pool (decelerating sqrt curve)
///         2. A TaxLossCertificate NFT as on-chain proof of disposal
///
///         Tokens are sent to the Vault (not burned) so the PoolManager can
///         extract their liquidity and feed the Buyback & Burn mechanism.
///         Honeypot protection via try/catch on the token transfer.
contract Incinerator is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ── State ─────────────────────────────────────────────────────────────────

    RCYToken public immutable rcy;
    Vault public immutable vault;
    PriceOracle public immutable oracle;
    TaxLossCertificate public immutable certificate;

    /// @notice Flat fee in BNB per burn transaction
    uint256 public flatFee;

    /// @notice Minimum $RCY awarded even when the token has no market price
    uint256 public minReward;

    /// @notice Scaling factor k in: RCY = minReward + k * sqrt(usdValue)
    ///         usdValue is expressed with 18 decimals, so k should be calibrated
    ///         such that k * sqrt(1e18) ≈ desired RCY for a $1 burn.
    uint256 public rewardK;

    /// @notice Treasury wallet — receives flat BNB fees
    address payable public treasury;

    // ── Events ────────────────────────────────────────────────────────────────

    event LogBurn(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 usdValue,
        uint256 rcyRewarded,
        uint256 certificateId
    );

    event LogBurnFailed(
        address indexed user,
        address indexed token,
        uint256 attemptedAmount,
        string reason
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address _rcy,
        address _vault,
        address _oracle,
        address _certificate,
        address payable _treasury,
        uint256 _flatFee,
        uint256 _minReward,
        uint256 _rewardK
    ) Ownable(msg.sender) {
        rcy = RCYToken(_rcy);
        vault = Vault(_vault);
        oracle = PriceOracle(_oracle);
        certificate = TaxLossCertificate(_certificate);
        treasury = _treasury;
        flatFee = _flatFee;
        minReward = _minReward;
        rewardK = _rewardK;
    }

    // ── Core logic ────────────────────────────────────────────────────────────

    /// @notice Burn `amount` of `token`. Tokens are sent to the Vault.
    /// @dev Caller must have approved this contract to spend `amount` of `token`.
    ///      If the token transfer fails (honeypot), the entire msg.value is
    ///      refunded to the caller — the user is never charged for a burn that
    ///      could not be executed. Excess BNB above flatFee is also refunded.
    function burn(address token, uint256 amount) external payable nonReentrant {
        require(msg.value >= flatFee, "Incinerator: insufficient fee");
        require(amount > 0, "Incinerator: amount must be > 0");
        require(token != address(0), "Incinerator: invalid token");
        require(token != address(rcy), "Incinerator: cannot burn RCY");

        // Attempt the token transfer first — safe against honeypots.
        // If it fails, refund the full msg.value and exit without charging.
        bool transferOk;
        string memory failReason;
        try IERC20(token).transferFrom(msg.sender, address(vault), amount) returns (bool success) {
            if (success) {
                transferOk = true;
            } else {
                failReason = "transferFrom returned false";
            }
        } catch Error(string memory reason) {
            failReason = reason;
        } catch {
            failReason = "unknown error";
        }

        if (!transferOk) {
            _refund(msg.sender, msg.value);
            emit LogBurnFailed(msg.sender, token, amount, failReason);
            return;
        }

        // Forward the flat fee to treasury and refund any excess to the caller.
        (bool feeSent, ) = treasury.call{value: flatFee}("");
        require(feeSent, "Incinerator: fee transfer failed");
        if (msg.value > flatFee) {
            _refund(msg.sender, msg.value - flatFee);
        }

        // Query USD value and compute reward
        uint256 usdValue = oracle.getUsdValue(token, amount);
        uint256 rcyAmount = _computeReward(usdValue);

        // Distribute $RCY from the rewards pool held by this contract
        if (rcyAmount > 0) {
            uint256 available = rcy.balanceOf(address(this));
            if (rcyAmount > available) rcyAmount = available; // cap to remaining pool
            if (rcyAmount > 0) {
                rcy.transfer(msg.sender, rcyAmount);
            }
        }

        // Mint Tax Loss Certificate NFT
        uint256 certId = certificate.mint(msg.sender, token, amount, usdValue);

        emit LogBurn(msg.sender, token, amount, usdValue, rcyAmount, certId);
    }

    /// @dev Internal BNB refund helper. Reverts if the recipient rejects.
    function _refund(address to, uint256 value) internal {
        (bool sent, ) = payable(to).call{value: value}("");
        require(sent, "Incinerator: refund failed");
    }

    // ── Reward curve ──────────────────────────────────────────────────────────

    /// @dev RCY = minReward + k * sqrt(usdValue)
    ///      Uses integer square root. usdValue has 18 decimals.
    function _computeReward(uint256 usdValue) internal view returns (uint256) {
        if (usdValue == 0) return minReward;
        return minReward + rewardK * _sqrt(usdValue);
    }

    /// @dev Integer square root (Babylonian method).
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setFlatFee(uint256 _flatFee) external onlyOwner {
        flatFee = _flatFee;
    }

    function setRewardParams(uint256 _minReward, uint256 _rewardK) external onlyOwner {
        minReward = _minReward;
        rewardK = _rewardK;
    }

    function setTreasury(address payable _treasury) external onlyOwner {
        treasury = _treasury;
    }
}
