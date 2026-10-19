#!/usr/bin/env node
// FR-7: is staging up? Writes up=true|false to GITHUB_OUTPUT. Never fails the job:
// a down environment is reported by post-results.mjs as one "Environment down"
// error instead of a wall of test failures.
import { appendFileSync } from "node:fs";

const targets = [process.env.BASE_URL, process.env.API_HEALTH_URL].filter(Boolean);
if (targets.length === 0) {
  console.error("BASE_URL is required");
  process.exit(1);
}

// Staging's basic-auth popup: send the credentials to the staging origin only.
const { STAGING_BASIC_USER: user, STAGING_BASIC_PASSWORD: password } = process.env;
const stagingOrigin = process.env.BASE_URL ? new URL(process.env.BASE_URL).origin : null;

function headersFor(url) {
  if (!user || !password || new URL(url).origin !== stagingOrigin) return {};
  return { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
}

async function responds(url) {
  try {
    const res = await fetch(url, { headers: headersFor(url), redirect: "follow", signal: AbortSignal.timeout(15_000) });
    console.log(`${url} -> HTTP ${res.status}`);
    return res.status < 500;
  } catch (error) {
    console.log(`${url} -> ${error.message}`);
    return false;
  }
}

const results = await Promise.all(targets.map(responds));
const up = results.every(Boolean);
console.log(up ? "Environment up" : "ENVIRONMENT DOWN — UI tests will be skipped");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `up=${up}\n`);
