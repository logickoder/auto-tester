#!/usr/bin/env node
/**
 * Converts a Playwright JUnit report into the Auto Tester results payload and
 * POSTs it to the results API. Zero dependencies on purpose.
 *
 * Env: AUTOTESTER_API_URL, AUTOTESTER_API_KEY, GITHUB_SHA, GITHUB_REF_NAME
 * Input: playwright-report/junit.xml (default) and evidence/*.png screenshots.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const apiUrl = process.env.AUTOTESTER_API_URL;
const apiKey = process.env.AUTOTESTER_API_KEY;
if (!apiUrl || !apiKey) {
  console.error("AUTOTESTER_API_URL and AUTOTESTER_API_KEY are required");
  process.exit(1);
}

const reportPath = process.env.JUNIT_PATH ?? "playwright-report/junit.xml";
let xml = "";
if (existsSync(reportPath)) xml = readFileSync(reportPath, "utf8");
else console.warn(`No JUnit report at ${reportPath}; reporting an error run`);

// Minimal JUnit parsing (testcase name/classname/time + failure/error children).
const tests = [];
for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>(.*?)<\/testcase>)/gs)) {
  const attrs = m[1];
  const inner = m[3] ?? "";
  const attr = (n) => new RegExp(`${n}="([^"]*)"`).exec(attrs)?.[1] ?? null;
  const name = attr("name") ?? "unnamed test";
  const feature = attr("classname") ?? null;
  const durationMs = Math.round(parseFloat(attr("time") ?? "0") * 1000);
  let status = "passed";
  let error = null;
  const fail = /<failure\b[^>]*>([\s\S]*?)<\/failure>/.exec(inner);
  const err = /<error\b[^>]*>([\s\S]*?)<\/error>/.exec(inner);
  if (fail) { status = "failed"; error = (fail[1] ?? "").trim().slice(0, 8000); }
  else if (err) { status = "error"; error = (err[1] ?? "").trim().slice(0, 8000); }
  else if (/<skipped\b/.test(inner)) status = "skipped";
  tests.push({ name, feature, priority: "P0", status, duration_ms: durationMs, error });
}

// Attach screenshots (evidence/failure-N.png) to failed tests in order.
const evidenceDir = "evidence";
if (existsSync(evidenceDir)) {
  const shots = readdirSync(evidenceDir).filter((f) => f.endsWith(".png"));
  const failed = tests.filter((t) => t.status === "failed" || t.status === "error");
  failed.forEach((t, i) => {
    if (shots[i]) {
      t.screenshot_base64 = readFileSync(`${evidenceDir}/${shots[i]}`).toString("base64");
    }
  });
}

if (tests.length === 0) {
  tests.push({
    name: "runner produced no results",
    feature: "runner",
    priority: "P0",
    status: "error",
    error: `No JUnit report found at ${reportPath}`,
  });
}

const payload = {
  branch: process.env.GITHUB_REF_NAME ?? "main",
  commit: process.env.GITHUB_SHA ?? null,
  trigger: process.env.TRIGGER ?? "nightly",
  environment: "staging",
  status: "completed",
  tests,
};

const res = await fetch(`${apiUrl}/api/runs`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
  body: JSON.stringify(payload),
});
const body = await res.text();
console.log(`Auto Tester ingest: ${res.status} ${body}`);
if (!res.ok) process.exit(1);
