import type { NextConfig } from "next";

// Nothing to configure. Hardhat's artifacts/ and cache/ are gitignored, so
// they never reach a deployment — an outputFileTracingExcludes rule for them
// bought nothing and its `cache/**` glob pruned Next's own incremental-cache
// files out of the serverless bundle, which took production down with a 500.
const config: NextConfig = {};

export default config;
