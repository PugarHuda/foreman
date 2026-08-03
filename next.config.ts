import type { NextConfig } from "next";

const config: NextConfig = {
  // Hardhat build output is not part of the app bundle.
  outputFileTracingExcludes: { "*": ["artifacts/**", "cache/**"] },
};

export default config;
