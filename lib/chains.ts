import { base, baseSepolia, hardhat } from "viem/chains";

/** CHAIN=local runs the whole demo against `npx hardhat node` — useful when
 *  venue wifi is not, and the fastest way to rehearse the agent loop. */
export const isLocal = () => process.env.CHAIN === "local";

/** CHAIN=base is the only setting where a mistake costs actual money. */
export const isMainnet = () => process.env.CHAIN === "base";

export const activeChain = () => (isLocal() ? hardhat : isMainnet() ? base : baseSepolia);

export const rpcUrl = () => {
  if (isLocal()) return "http://127.0.0.1:8545";
  if (isMainnet()) return process.env.BASE_RPC || "https://mainnet.base.org";
  return process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
};

/**
 * Circle's canonical USDC, per chain.
 *
 * Held here so a deployment can be checked against it rather than trusted.
 * The failure this catches is not exotic — it is pointing a mainnet contract
 * at the mock ERC-20 the demo deploys, or at an address with a typo in it,
 * and only finding out when a supplier says the payment never arrived.
 */
export const CANONICAL_USDC: Record<number, `0x${string}`> = {
  8453: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base
  84532: "0x036cbd53842c5426634e7929541ec2318f3dcf7e", // Base Sepolia (testnet USDC)
};

export const canonicalUsdc = () => CANONICAL_USDC[activeChain().id];
