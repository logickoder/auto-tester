import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "https://staging.zedu.chat";

// NFR Safety: refuse to run against anything that is not an allow-listed staging host.
const ALLOWED_HOSTS = (process.env.STAGING_ALLOWLIST ?? "staging.zedu.chat,localhost")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const host = new URL(BASE_URL).hostname.toLowerCase();
if (!ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
  throw new Error(`Refusing to run against ${host}: not a staging host (allowed: ${ALLOWED_HOSTS.join(", ")})`);
}

// FR-2: tests switched off in the manifest never run.
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8")) as {
  tests: Array<{ name: string; enabled?: boolean }>;
};
const disabled = manifest.tests
  .filter((t) => t.enabled === false)
  .map((t) => t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0, // FR-12: retry twice, in CI only
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  grepInvert: disabled.length ? new RegExp(disabled.join("|")) : undefined,
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "report/results.json" }]]
    : [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure", // FR-12
    trace: "on-first-retry", // FR-12
    video: "off",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /global\.setup\.ts/,
    },
  ],
});
