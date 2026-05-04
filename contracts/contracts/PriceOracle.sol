// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

// ── External interfaces ────────────────────────────────────────────────────────

interface IChainlinkFeed {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
    function decimals() external view returns (uint8);
}

interface IPancakeV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IPancakeV3Pool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory);
    function token0() external view returns (address);
}

interface IPancakeV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IPancakeV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32);
    function token0() external view returns (address);
}

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @title PriceOracle — USD value estimator for arbitrary ERC-20 tokens
/// @notice Pricing strategy (in order of priority):
///         1. PancakeSwap V3 TWAP 30 min on token/WBNB pair (any fee tier)
///         2. PancakeSwap V2 spot price on token/WBNB pair
///         3. Returns 0 — Incinerator applies minReward
///
///         All prices are denominated in USD with 18 decimals.
///         BNB/USD price sourced from Chainlink.
contract PriceOracle is Ownable {
    // ── Constants ─────────────────────────────────────────────────────────────

    uint32 public constant TWAP_PERIOD = 1800; // 30 minutes

    /// @dev Maximum staleness for the BNB/USD Chainlink feed (1h heartbeat + buffer).
    uint256 public constant MAX_PRICE_STALENESS = 3600;

    /// @dev Minimum WBNB reserve required for the V2 spot fallback to be trusted.
    ///      Smaller pools are too cheap to manipulate via flash loans within a block.
    uint256 public constant MIN_V2_WBNB_RESERVE = 10 ether;

    // PancakeSwap V3 fee tiers to probe (in order)
    uint24[3] private FEE_TIERS = [100, 500, 2500];

    // ── State ─────────────────────────────────────────────────────────────────

    address public immutable wbnb;
    IPancakeV3Factory public immutable v3Factory;
    IPancakeV2Factory public immutable v2Factory;
    IChainlinkFeed public immutable bnbUsdFeed;

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address _wbnb,
        address _v3Factory,
        address _v2Factory,
        address _bnbUsdFeed
    ) Ownable(msg.sender) {
        wbnb = _wbnb;
        v3Factory = IPancakeV3Factory(_v3Factory);
        v2Factory = IPancakeV2Factory(_v2Factory);
        bnbUsdFeed = IChainlinkFeed(_bnbUsdFeed);
    }

    // ── Public interface ──────────────────────────────────────────────────────

    /// @notice Returns the USD value of `amount` units of `token` (18 decimals).
    ///         Returns 0 if no price source is available.
    function getUsdValue(address token, uint256 amount) external view returns (uint256) {
        if (token == wbnb) {
            return _bnbToUsd(amount);
        }

        uint256 bnbAmount = _getBnbAmount(token, amount);
        if (bnbAmount == 0) return 0;

        return _bnbToUsd(bnbAmount);
    }

    // ── Internal pricing ──────────────────────────────────────────────────────

    /// @dev Returns how many WBNB wei `amount` of `token` is worth.
    ///      Tries V3 TWAP first, then V2 spot.
    function _getBnbAmount(address token, uint256 amount) internal view returns (uint256) {
        // 1. Try PancakeSwap V3 TWAP
        for (uint256 i = 0; i < FEE_TIERS.length; i++) {
            address pool = v3Factory.getPool(token, wbnb, FEE_TIERS[i]);
            if (pool == address(0)) continue;

            uint256 bnbAmount = _v3TwapQuote(pool, token, amount);
            if (bnbAmount > 0) return bnbAmount;
        }

        // 2. Fallback: PancakeSwap V2 spot
        address pair = v2Factory.getPair(token, wbnb);
        if (pair != address(0)) {
            return _v2SpotQuote(pair, token, amount);
        }

        return 0;
    }

    /// @dev Computes a 30-min TWAP quote from a PancakeSwap V3 pool.
    ///      Returns 0 if the pool doesn't have enough observation history.
    function _v3TwapQuote(
        address pool,
        address token,
        uint256 amount
    ) internal view returns (uint256) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = TWAP_PERIOD;
        secondsAgos[1] = 0;

        try IPancakeV3Pool(pool).observe(secondsAgos) returns (
            int56[] memory tickCumulatives,
            uint160[] memory
        ) {
            int56 delta = tickCumulatives[1] - tickCumulatives[0];
            int24 meanTick = int24(delta / int56(uint56(TWAP_PERIOD)));

            // Convert tick to price: sqrtPriceX96 = sqrt(1.0001^tick) * 2^96
            // price (token1/token0) = sqrtPrice^2 / 2^192
            // We compute how much WBNB is 1 unit of token.
            bool tokenIsToken0 = IPancakeV3Pool(pool).token0() == token;

            return _tickToQuote(meanTick, token, amount, tokenIsToken0);
        } catch {
            return 0;
        }
    }

    /// @dev Approximates (1.0001^tick) using precomputed bit-shift constants
    ///      following the Uniswap v3 TickMath pattern (condensed version).
    ///      Returns how many WBNB wei `amount` of `token` is worth.
    function _tickToQuote(
        int24 tick,
        address token,
        uint256 amount,
        bool tokenIsToken0
    ) internal view returns (uint256) {
        // Compute sqrtRatioX96 = sqrt(1.0001^tick) * 2^96
        uint256 sqrtRatioX96 = _getSqrtRatioAtTick(tick);
        if (sqrtRatioX96 == 0) return 0;

        uint8 tokenDecimals = _safeDecimals(token);

        // price = sqrtRatioX96^2 / 2^192  (token1 per token0)
        // We need to scale by token decimals to get WBNB in 1e18
        uint256 priceX192;
        unchecked {
            // sqrtRatioX96 fits in uint160, so squaring can overflow uint256 —
            // we first downscale to X128 by shifting right 64 bits then squaring.
            uint256 sqrtX64 = sqrtRatioX96 >> 32;
            priceX192 = sqrtX64 * sqrtX64; // X128
        }

        uint256 wbnbAmount;
        if (tokenIsToken0) {
            // price = token1 (WBNB) per token0 (our token)
            // wbnb = amount * price * 1e18 / 10^tokenDecimals / 2^128
            wbnbAmount = (amount * priceX192 * 1e18) /
                (10 ** tokenDecimals) /
                (2 ** 128);
        } else {
            // price = token0 (our token) per token1 (WBNB) → invert
            // wbnb = amount * 1e18 / (price * 10^tokenDecimals / 2^128)
            if (priceX192 == 0) return 0;
            wbnbAmount = (amount * (2 ** 128) * 1e18) /
                (priceX192 * 10 ** tokenDecimals);
        }

        return wbnbAmount;
    }

    /// @dev Condensed TickMath.getSqrtRatioAtTick — returns sqrtPriceX96.
    ///      Based on Uniswap v3 TickMath (MIT License).
    function _getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        require(absTick <= 887272, "PriceOracle: tick out of range");

        uint256 ratio = absTick & 0x1 != 0
            ? 0xfffcb933bd6fad37aa2d162d1a594001
            : 0x100000000000000000000000000000000;

        if (absTick & 0x2 != 0)  ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
        if (absTick & 0x4 != 0)  ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
        if (absTick & 0x8 != 0)  ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
        if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
        if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
        if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
        if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
        if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
        if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
        if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
        if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
        if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
        if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
        if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
        if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
        if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
        if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

        if (tick > 0) ratio = type(uint256).max / ratio;

        // Downscale from Q128.128 to Q64.96 (sqrtPriceX96)
        sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
    }

    /// @dev Returns V2 spot price: how many WBNB wei `amount` of `token` is worth.
    ///      Returns 0 if the pool has less than MIN_V2_WBNB_RESERVE on the WBNB
    ///      side. Spot prices on tiny pools can be manipulated cheaply via a
    ///      flash-loan-funded swap in the same block.
    function _v2SpotQuote(
        address pair,
        address token,
        uint256 amount
    ) internal view returns (uint256) {
        (uint112 reserve0, uint112 reserve1, ) = IPancakeV2Pair(pair).getReserves();
        if (reserve0 == 0 || reserve1 == 0) return 0;

        bool tokenIsToken0 = IPancakeV2Pair(pair).token0() == token;

        uint256 tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
        uint256 wbnbReserve  = tokenIsToken0 ? reserve1 : reserve0;

        if (wbnbReserve < MIN_V2_WBNB_RESERVE) return 0;

        return (amount * wbnbReserve) / tokenReserve;
    }

    /// @dev Converts a WBNB amount (1e18) to USD (1e18) using Chainlink.
    ///      Returns 0 if the feed price is non-positive, stale, or from an
    ///      incomplete round. The caller (Incinerator) treats 0 as "no price"
    ///      and falls back to minReward.
    function _bnbToUsd(uint256 bnbAmount) internal view returns (uint256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = bnbUsdFeed.latestRoundData();

        if (price <= 0) return 0;
        if (updatedAt == 0) return 0;
        if (answeredInRound < roundId) return 0;
        if (block.timestamp - updatedAt > MAX_PRICE_STALENESS) return 0;

        uint8 feedDecimals = bnbUsdFeed.decimals();
        return (bnbAmount * uint256(price)) / (10 ** feedDecimals);
    }

    /// @dev Safe decimals call — defaults to 18 if the call reverts.
    function _safeDecimals(address token) internal view returns (uint8) {
        try IERC20Decimals(token).decimals() returns (uint8 d) {
            return d;
        } catch {
            return 18;
        }
    }
}
