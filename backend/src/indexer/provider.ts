import { ethers } from "ethers";
import { config } from "../config";

type Provider = ethers.JsonRpcProvider | ethers.WebSocketProvider;

let _provider: Provider | null = null;

/// @notice Returns a singleton ethers provider for the configured RPC URL.
///         When the URL starts with `ws://` or `wss://`, uses
///         `WebSocketProvider` so events are delivered via native
///         `eth_subscribe`. Otherwise falls back to HTTP polling via
///         `JsonRpcProvider` — note that polling has a known bug against
///         Hardhat (FilterIdEventSubscriber crashes on empty responses),
///         so prefer WebSocket for local development.
export function getProvider(): Provider {
  if (!_provider) {
    if (config.rpcUrl.startsWith("ws://") || config.rpcUrl.startsWith("wss://")) {
      _provider = new ethers.WebSocketProvider(config.rpcUrl, config.chainId);
    } else {
      _provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
    }
  }
  return _provider;
}
