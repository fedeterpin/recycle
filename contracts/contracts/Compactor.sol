// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./RCYFractionalReceipt.sol";

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

/// @title Compactor — Pools dust tokens into per-token batches and swaps them for BNB
/// @notice Users deposit small amounts of an ERC-20 into a batch and receive an
///         ERC-1155 receipt. The multisig (EXECUTOR_ROLE) calls executeBatch to
///         swap the entire batch on PancakeSwap V2; users then burn their receipt
///         to claim BNB pro-rata. If the swap is not viable, the multisig calls
///         failBatch and users redeem their original tokens via redeemDust.
contract Compactor is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    uint256 public constant MAX_FEE_BPS = 2000; // 20% cap
    uint256 public constant BPS_DENOM   = 10_000;

    enum BatchStatus { Open, Executed, Failed }

    struct Batch {
        uint256 totalDeposited; // total tokens received by the contract for this batch
        uint256 totalReceipts;  // total receipt supply for this batch (== totalDeposited via balance-delta)
        uint256 bnbForUsers;    // BNB allocated to users after the protocol fee (set on execute)
        BatchStatus status;
    }

    RCYFractionalReceipt public immutable receipt;
    address public immutable router;

    address payable public treasury;
    uint256 public protocolFeeBps = 1000; // 10%

    mapping(address token => uint256) public currentBatchId;
    mapping(address token => mapping(uint256 batchId => Batch)) public batches;
    mapping(uint256 receiptTokenId => address) public tokenOfReceipt;
    mapping(uint256 receiptTokenId => uint256) public batchOfReceipt;

    event DustDeposited(
        address indexed user,
        address indexed token,
        uint256 indexed batchId,
        uint256 amount,
        uint256 receiptTokenId
    );
    event BatchExecuted(
        address indexed token,
        uint256 indexed batchId,
        uint256 totalIn,
        uint256 bnbReceived,
        uint256 protocolFee,
        uint256 bnbForUsers
    );
    event BatchFailed(address indexed token, uint256 indexed batchId);
    event BnbClaimed(
        address indexed user,
        address indexed token,
        uint256 indexed batchId,
        uint256 receiptAmount,
        uint256 bnbAmount
    );
    event DustRedeemed(
        address indexed user,
        address indexed token,
        uint256 indexed batchId,
        uint256 receiptAmount,
        uint256 tokenAmount
    );
    event ProtocolFeeUpdated(uint256 oldBps, uint256 newBps);
    event TreasuryUpdated(address oldTreasury, address newTreasury);

    constructor(
        address _receipt,
        address _router,
        address payable _treasury,
        address admin
    ) {
        require(_receipt != address(0), "Compactor: receipt zero");
        require(_router != address(0), "Compactor: router zero");
        require(_treasury != address(0), "Compactor: treasury zero");
        receipt = RCYFractionalReceipt(_receipt);
        router = _router;
        treasury = _treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(EXECUTOR_ROLE, admin);
    }

    // ── Core flow ─────────────────────────────────────────────────────────────

    /// @notice Deposit `amount` of `token` into the current open batch. Caller
    ///         receives an ERC-1155 receipt. Uses balance delta to support
    ///         fee-on-transfer tokens.
    function depositDust(address token, uint256 amount) external nonReentrant {
        require(token != address(0), "Compactor: invalid token");
        require(amount > 0, "Compactor: amount must be > 0");

        uint256 batchId = currentBatchId[token];
        Batch storage b = batches[token][batchId];
        require(b.status == BatchStatus.Open, "Compactor: batch not open");

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "Compactor: nothing received");

        b.totalDeposited += received;
        b.totalReceipts  += received;

        uint256 tokenId = _receiptTokenId(token, batchId);
        if (tokenOfReceipt[tokenId] == address(0)) {
            tokenOfReceipt[tokenId] = token;
            batchOfReceipt[tokenId] = batchId;
        }

        receipt.mint(msg.sender, tokenId, received);

        emit DustDeposited(msg.sender, token, batchId, received, tokenId);
    }

    /// @notice Swap the entire current batch of `token` for BNB. Reverts if the
    ///         swap fails so the multisig can retry; an explicit failBatch call
    ///         is required to mark the batch as FAILED for redemption.
    function executeBatch(address token, uint256 minAmountOut)
        external
        nonReentrant
        onlyRole(EXECUTOR_ROLE)
    {
        uint256 batchId = currentBatchId[token];
        Batch storage b = batches[token][batchId];
        require(b.status == BatchStatus.Open, "Compactor: batch not open");
        require(b.totalDeposited > 0, "Compactor: batch empty");

        uint256 feeBps = protocolFeeBps; // snapshot at execute time

        IERC20(token).forceApprove(router, b.totalDeposited);

        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = IPancakeV2Router(router).WETH();

        uint256 balanceBefore = address(this).balance;

        try IPancakeV2Router(router).swapExactTokensForETHSupportingFeeOnTransferTokens(
            b.totalDeposited,
            minAmountOut,
            path,
            address(this),
            block.timestamp + 300
        ) {
            // success
        } catch {
            IERC20(token).forceApprove(router, 0);
            revert("Compactor: swap failed");
        }

        IERC20(token).forceApprove(router, 0);

        uint256 bnbReceived = address(this).balance - balanceBefore;
        uint256 fee = (bnbReceived * feeBps) / BPS_DENOM;
        uint256 forUsers = bnbReceived - fee;

        b.bnbForUsers = forUsers;
        b.status = BatchStatus.Executed;
        currentBatchId[token] = batchId + 1;

        if (fee > 0) {
            (bool ok, ) = treasury.call{value: fee}("");
            require(ok, "Compactor: fee transfer failed");
        }

        emit BatchExecuted(token, batchId, b.totalDeposited, bnbReceived, fee, forUsers);
    }

    /// @notice Mark the current open batch of `token` as FAILED so users can
    ///         redeem their original tokens via redeemDust. Multisig only.
    function failBatch(address token, uint256 batchId)
        external
        onlyRole(EXECUTOR_ROLE)
    {
        Batch storage b = batches[token][batchId];
        require(b.status == BatchStatus.Open, "Compactor: batch not open");
        b.status = BatchStatus.Failed;
        if (batchId == currentBatchId[token]) {
            currentBatchId[token] = batchId + 1;
        }
        emit BatchFailed(token, batchId);
    }

    /// @notice Burn `receiptAmount` of the receipt for (token, batchId) and
    ///         receive BNB pro-rata to the batch's bnbForUsers pool.
    function claimBNB(address token, uint256 batchId, uint256 receiptAmount)
        external
        nonReentrant
    {
        require(receiptAmount > 0, "Compactor: amount must be > 0");
        Batch storage b = batches[token][batchId];
        require(b.status == BatchStatus.Executed, "Compactor: batch not executed");

        uint256 payout = (receiptAmount * b.bnbForUsers) / b.totalReceipts;

        receipt.burn(msg.sender, _receiptTokenId(token, batchId), receiptAmount);

        (bool ok, ) = msg.sender.call{value: payout}("");
        require(ok, "Compactor: BNB transfer failed");

        emit BnbClaimed(msg.sender, token, batchId, receiptAmount, payout);
    }

    /// @notice Burn `receiptAmount` of the receipt for a FAILED batch and
    ///         recover the original tokens pro-rata.
    function redeemDust(address token, uint256 batchId, uint256 receiptAmount)
        external
        nonReentrant
    {
        require(receiptAmount > 0, "Compactor: amount must be > 0");
        Batch storage b = batches[token][batchId];
        require(b.status == BatchStatus.Failed, "Compactor: batch not failed");

        uint256 payout = (receiptAmount * b.totalDeposited) / b.totalReceipts;

        receipt.burn(msg.sender, _receiptTokenId(token, batchId), receiptAmount);

        IERC20(token).safeTransfer(msg.sender, payout);

        emit DustRedeemed(msg.sender, token, batchId, receiptAmount, payout);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setProtocolFee(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps <= MAX_FEE_BPS, "Compactor: fee too high");
        uint256 old = protocolFeeBps;
        protocolFeeBps = bps;
        emit ProtocolFeeUpdated(old, bps);
    }

    function setTreasury(address payable _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0), "Compactor: treasury zero");
        address old = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(old, _treasury);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _receiptTokenId(address token, uint256 batchId) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(token, batchId)));
    }

    receive() external payable {}
}
