#!/usr/bin/env node
// Registers the run as "running" so the dashboard shows it at once (FR-17).
// Prints run_id to GITHUB_OUTPUT; post-results.mjs PATCHes that run when tests finish.
import { appendFileSync } from "node:fs";
import { apiConfig, runMeta } from "./lib.mjs";

const { url, headers } = apiConfig();
const payload = { ...runMeta(), status: "running", started_at: new Date().toISOString(), tests: [] };

try {
  const res = await fetch(`${url}/api/runs`, { method: "POST", headers, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  console.log(`Run registered: ${body.id}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run_id=${body.id}\n`);
} catch (error) {
  // Not fatal: post-results.mjs creates the run at the end instead.
  console.warn(`Could not register the run: ${error.message}`);
}
