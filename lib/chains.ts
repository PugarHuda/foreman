import { baseSepolia, hardhat } from "viem/chains";

/** CHAIN=local runs the whole demo against `npx hardhat node` — useful when
 *  venue wifi is not, and the fastest way to rehearse the agent loop. */
export const isLocal = () => process.env.CHAIN === "local";

export const activeChain = () => (isLocal() ? hardhat : baseSepolia);

export const rpcUrl = () =>
  isLocal() ? "http://127.0.0.1:8545" : process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
