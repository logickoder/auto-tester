// Shared bits for the runner scripts. Zero dependencies on purpose (supply-chain rule).
import { execSync } from "node:child_process";

export function apiConfig() {
  const url = process.env.AUTOTESTER_API_URL?.replace(/\/+$/, "");
  const key = process.env.AUTOTESTER_API_KEY;
  if (!url || !key) {
    console.error("AUTOTESTER_API_URL and AUTOTESTER_API_KEY are required");
    process.exit(1);
  }
  return { url, headers: { "Content-Type": "application/json", "X-API-Key": key } };
}

export function runMeta() {
  let commitMessage = process.env.COMMIT_MESSAGE ?? null;
  if (!commitMessage) {
    try {
      commitMessage = execSync("git log -1 --pretty=%s", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim()
        .slice(0, 500);
    } catch {
      /* not a git checkout */
    }
  }
  return {
    branch: process.env.GITHUB_REF_NAME ?? "main",
    commit: process.env.GITHUB_SHA ?? null,
    commit_message: commitMessage,
    trigger: process.env.TRIGGER ?? "manual",
    environment: "staging",
  };
}
