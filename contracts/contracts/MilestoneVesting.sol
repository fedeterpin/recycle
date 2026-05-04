// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MilestoneVesting — Team token vesting gated by real-world milestones
/// @notice Holds 150,000,000 $RCY for the team. Tokens unlock in 4 equal tranches
///         (25% each) as the Multisig verifies that off-chain milestones are met.
///
///         Each beneficiary has a fixed total allocation. After N milestones are
///         unlocked, they can claim up to (allocation * N / 4) cumulative tokens.
///
///         Milestone examples (defined off-chain):
///           1 — Testnet deployment + audit complete
///           2 — Mainnet launch + 1,000 active users
///           3 — $1M cumulative liquidity rescued
///           4 — CEX listing or 10,000 active users
///
///         The UNLOCKER_ROLE is granted to the Multisig (Gnosis Safe).
///         The DEFAULT_ADMIN_ROLE is granted to the Timelock (72h delay).
contract MilestoneVesting is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant UNLOCKER_ROLE = keccak256("UNLOCKER_ROLE");

    // ── Constants ─────────────────────────────────────────────────────────────

    uint256 public constant TOTAL_MILESTONES = 4;

    // ── State ─────────────────────────────────────────────────────────────────

    IERC20 public immutable rcy;

    /// @notice Number of milestones unlocked so far (0–4)
    uint256 public unlockedMilestones;

    /// @notice Total $RCY allocation per beneficiary
    mapping(address => uint256) public allocation;

    /// @notice Cumulative $RCY already claimed per beneficiary
    mapping(address => uint256) public claimed;

    address[] public beneficiaries;

    // ── Events ────────────────────────────────────────────────────────────────

    event MilestoneUnlocked(uint256 indexed milestone, uint256 timestamp);
    event TokensClaimed(address indexed beneficiary, uint256 amount);
    event BeneficiaryAdded(address indexed beneficiary, uint256 allocation);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _rcy, address admin) {
        rcy = IERC20(_rcy);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UNLOCKER_ROLE, admin);
    }

    // ── Admin — beneficiary setup ─────────────────────────────────────────────

    /// @notice Register a beneficiary with their total RCY allocation.
    ///         Call this before transferring tokens to the contract.
    ///         Total allocations must equal the token balance transferred.
    function addBeneficiary(address beneficiary, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(beneficiary != address(0), "MilestoneVesting: zero address");
        require(allocation[beneficiary] == 0, "MilestoneVesting: already registered");
        require(amount > 0, "MilestoneVesting: zero amount");

        allocation[beneficiary] = amount;
        beneficiaries.push(beneficiary);

        emit BeneficiaryAdded(beneficiary, amount);
    }

    // ── Milestone unlock ──────────────────────────────────────────────────────

    /// @notice Unlock the next milestone. Only callable by the Multisig.
    ///         Each call unlocks 25% more of each beneficiary's allocation.
    function unlockNextMilestone() external onlyRole(UNLOCKER_ROLE) {
        require(
            unlockedMilestones < TOTAL_MILESTONES,
            "MilestoneVesting: all milestones unlocked"
        );
        unlockedMilestones++;
        emit MilestoneUnlocked(unlockedMilestones, block.timestamp);
    }

    // ── Claiming ──────────────────────────────────────────────────────────────

    /// @notice Claim all available $RCY for the caller.
    ///         Available = (allocation * unlockedMilestones / 4) - already claimed
    function claim() external nonReentrant {
        uint256 available = claimable(msg.sender);
        require(available > 0, "MilestoneVesting: nothing to claim");

        claimed[msg.sender] += available;
        rcy.safeTransfer(msg.sender, available);

        emit TokensClaimed(msg.sender, available);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    /// @notice Returns how many $RCY the caller can claim right now.
    function claimable(address beneficiary) public view returns (uint256) {
        if (unlockedMilestones == 0) return 0;
        uint256 unlocked = (allocation[beneficiary] * unlockedMilestones) / TOTAL_MILESTONES;
        uint256 alreadyClaimed = claimed[beneficiary];
        if (unlocked <= alreadyClaimed) return 0;
        return unlocked - alreadyClaimed;
    }

    /// @notice Returns the full list of registered beneficiaries.
    function getBeneficiaries() external view returns (address[] memory) {
        return beneficiaries;
    }
}
