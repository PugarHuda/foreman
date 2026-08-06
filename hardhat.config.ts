import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    baseSepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
  // Sourcify and Blockscout need no API key, so anyone cloning this can
  // verify their own deployment without signing up for anything.
  verify: {
    sourcify: { enabled: true },
    blockscout: { enabled: true },
    etherscan: { apiKey: process.env.ETHERSCAN_API_KEY ?? "" },
  },
};

export default config;
