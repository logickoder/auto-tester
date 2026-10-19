#!/usr/bin/env node
// Converts Playwright's JSON report into the Auto Tester payload and sends it.
//   AUTOTESTER_RUN_ID set  -> PATCH /api/runs/{id}  (finishes the "running" run)
//   otherwise              -> POST  /api/runs
// Flaky detection (FR-20), priorities from @P0/@P1 tags, owners from the manifest,
// failure screenshots from the report's attachments (FR-12/FR-19).
import { existsSync, readFileSync } from "node:fs";
import { apiConfig, runMeta } from "./lib.mjs";

const { url, headers } = apiConfig();
const runId = process.env.AUTOTESTER_RUN_ID || null;
const envDown = process.env.ENV_DOWN === "true";
const reportPath = process.env.REPORT_PATH ?? "report/results.json";
const MAX_SCREENSHOTS = 25; // API limit per run

let manifest = [];
try {
  manifest = JSON.parse(readFileSync("manifest.json", "utf8")).tests ?? [];
} catch {
  /* no manifest: priorities default to P0, owners to null */
}
const byName = new Map(manifest.map((t) => [t.name, t]));

const stripAnsi = (s) => (s ?? "").replace(/\u001b\[[0-9;]*m/g, "");
const cleanTitle = (title) => title.replace(/\s*@\w+/g, "").trim();
const priorityOf = (title, fallback) => /@(P[012])\b/.exec(title)?.[1] ?? fallback;
function featureOf(file) {
  // "messaging/send-receive.spec.ts" or "tests/messaging/x.spec.ts" -> "messaging"
  const dirs = file.split(/[\\/]/).filter(Boolean).slice(0, -1).filter((d) => d !== "tests");
  return dirs[0] ?? null;
}

function collectSpecs(suite, file = "", out = []) {
  const current = suite.file ?? file;
  for (const spec of suite.specs ?? []) out.push({ ...spec, file: spec.file ?? current });
  for (const child of suite.suites ?? []) collectSpecs(child, current, out);
  return out;
}

function toTest(spec) {
  const name = cleanTitle(spec.title);
  const entry = byName.get(name);
  const result = spec.tests?.[0]; // one project per spec (setup or chromium)
  const attempts = result?.results ?? [];
  const last = attempts[attempts.length - 1];

  let status;
  switch (result?.status) {
    case "expected":
      status = "passed";
      break;
    case "flaky":
      status = "flaky"; // failed, then passed on retry (FR-20)
      break;
    case "skipped":
      status = "skipped";
      break;
    case "unexpected":
      status = last?.status === "interrupted" ? "error" : "failed";
      break;
    default:
      status = "error";
  }

  const failedAttempt = [...attempts].reverse().find((a) => a.status !== "passed" && a.status !== "skipped");
  const error = failedAttempt?.error
    ? stripAnsi(failedAttempt.error.message ?? failedAttempt.error.stack ?? "").slice(0, 8000)
    : null;

  const test = {
    name,
    feature: entry?.feature ?? featureOf(spec.file ?? ""),
    priority: priorityOf(spec.title, entry?.priority ?? "P0"),
    status,
    duration_ms: attempts.reduce((sum, a) => sum + (a.duration ?? 0), 0),
    error,
    owner: entry?.owner ?? null,
  };

  if (status === "failed" || status === "error") {
    // Latest attempt that has a screenshot on disk (Playwright attaches one per failed attempt).
    const shot = [...attempts]
      .reverse()
      .flatMap((a) => a.attachments ?? [])
      .find((a) => a.contentType === "image/png" && a.path && existsSync(a.path));
    if (shot) test.screenshot_base64 = readFileSync(shot.path).toString("base64");
  }
  return test;
}

let tests = [];
if (envDown) {
  tests = [
    {
      name: "Environment down: staging did not respond",
      feature: "environment",
      priority: "P0",
      status: "error",
      error: `Health check failed for ${process.env.BASE_URL ?? "BASE_URL"}. UI tests were not run.`,
    },
  ];
} else if (existsSync(reportPath)) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  tests = collectSpecs({ suites: report.suites ?? [] }).map(toTest);
  let shots = 0;
  for (const t of tests) if (t.screenshot_base64 && ++shots > MAX_SCREENSHOTS) delete t.screenshot_base64;
} else {
  console.warn(`No report at ${reportPath}`);
}
if (tests.length === 0) {
  tests = [
    {
      name: "runner produced no results",
      feature: "runner",
      priority: "P0",
      status: "error",
      error: `No Playwright report found at ${reportPath}`,
    },
  ];
}

const status = envDown ? "error" : "completed";
const finished_at = new Date().toISOString();
const res = runId
  ? await fetch(`${url}/api/runs/${runId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status, finished_at, tests }),
    })
  : await fetch(`${url}/api/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...runMeta(), status, finished_at, tests }),
    });

const body = await res.text();
console.log(`Auto Tester ingest: ${res.status} ${body.slice(0, 500)}`);
if (!res.ok) process.exit(1);
