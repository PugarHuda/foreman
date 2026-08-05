import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e suite runs against a dev server on an already-deployed contract.
 * It deliberately does not exercise the agent: that call costs money, takes
 * ~40s, and depends on a model provider — none of which belong in a suite
 * meant to run on every change. The agent path is covered by the contract
 * tests and by the manual demo script in the README.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
