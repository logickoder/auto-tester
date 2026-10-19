"use client";

import { use, useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { Run, TestResult } from "@/lib/types";
import { duration, VERDICT_LABEL } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";

const STATUS_STYLES: Record<string, string> = {
  passed: "text-emerald-400",
  failed: "text-red-400",
  error: "text-red-400",
  flaky: "text-amber-400",
  skipped: "text-muted",
};

function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{children}</span>;
}

function TestRow({ test }: { test: TestResult }) {
  return (
    <details className="group border-b border-border last:border-0">
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-panel/60 list-none [&::-webkit-details-marker]:hidden">
        <span className={`w-16 text-xs font-medium uppercase ${STATUS_STYLES[test.status] ?? "text-muted"}`}>
          {test.status}
        </span>
        <span className="flex-1 truncate">{test.name}</span>
        {test.feature && <Pill>{test.feature}</Pill>}
        <Pill>{test.priority}</Pill>
        {test.owner && <Pill>owner: {test.owner}</Pill>}
        {test.duration_ms != null && (
          <span className="w-16 text-right text-xs text-muted">{test.duration_ms}ms</span>
        )}
        <span className="text-muted group-open:rotate-90 transition-transform">›</span>
      </summary>
      <div className="border-t border-border bg-background/60 px-4 py-4 flex flex-col gap-4">
        {test.error && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted">Error</p>
            <pre className="overflow-x-auto rounded-lg border border-border bg-panel p-3 text-xs text-red-300 whitespace-pre-wrap">
              {test.error}
            </pre>
          </div>
        )}
        {test.screenshot_url && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted">Screenshot</p>
            {/* Screenshot comes from our own API / signed URL, not remote hosts. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={test.screenshot_url}
              alt={`Failure screenshot: ${test.name}`}
              className="max-h-96 rounded-lg border border-border"
            />
          </div>
        )}
        {!test.error && !test.screenshot_url && (
          <p className="text-sm text-muted">No error details for this test.</p>
        )}
      </div>
    </details>
  );
}

function TestTable({ tests }: { tests: TestResult[] }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {tests.map((t) => (
        <TestRow key={t.id} test={t} />
      ))}
    </div>
  );
}

/** FR-26 / FR-27: Approve or Block with a comment; an override reason is needed on Not Ready. */
function SignoffPanel({ run, onChanged }: { run: Run; onChanged: () => void }) {
  const blocked = run.verdict === "not_ready" || run.verdict === "error";
  const [decision, setDecision] = useState<"approve" | "block">(blocked ? "block" : "approve");
  const [comment, setComment] = useState("");
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsOverride = decision === "approve" && blocked;
  const latest = run.signoffs?.[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/runs/${run.id}/signoff`, {
        decision,
        comment: comment.trim() || null,
        override_reason: needsOverride ? override.trim() || null : null,
      });
      setComment("");
      setOverride("");
      onChanged();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <section className="rounded-2xl border border-border bg-panel/80 p-5 shadow-lg shadow-black/20 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Release sign-off</h2>
        {latest ? (
          <span
            className={`rounded-full border px-3 py-1 text-sm ${
              latest.decision === "approve"
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-red-500/40 bg-red-500/15 text-red-300"
            }`}
          >
            {latest.decision === "approve" ? "Approved" : "Blocked"} by {latest.decided_by_email}
          </span>
        ) : (
          <span className="text-sm text-muted">No decision yet</span>
        )}
      </div>

      {run.signoffs && run.signoffs.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          {run.signoffs.map((s) => (
            <li key={s.id} className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
              <span className={s.decision === "approve" ? "text-emerald-400" : "text-red-400"}>
                {s.decision === "approve" ? "Approve" : "Block"}
              </span>
              <span className="text-muted">
                {" "}
                · {s.decided_by_email} · {new Date(s.created_at).toLocaleString()}
              </span>
              {s.comment && <p className="mt-1">{s.comment}</p>}
              {s.override_reason && <p className="mt-1 text-amber-300">Override: {s.override_reason}</p>}
            </li>
          ))}
        </ul>
      )}

      {run.verdict === "running" ? (
        <p className="text-sm text-muted">Sign-off opens when the run finishes.</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="decision"
                checked={decision === "approve"}
                onChange={() => setDecision("approve")}
                className="accent-emerald-500"
              />
              Approve release
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="decision"
                checked={decision === "block"}
                onChange={() => setDecision("block")}
                className="accent-red-500"
              />
              Block release
            </label>
          </div>
          <textarea
            className={input}
            rows={2}
            placeholder="Comment (why)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {needsOverride && (
            <label className="text-sm">
              <span className="mb-1 block text-amber-300">
                This run is {VERDICT_LABEL[run.verdict]}. An override reason is required to approve it.
              </span>
              <input
                className={input}
                required
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                placeholder="e.g. failing test is a known staging data issue, ticket ZED-123"
              />
            </label>
          )}
          {error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="self-start rounded-lg border border-border px-4 py-2 text-sm hover:border-accent disabled:opacity-60"
          >
            {busy ? "Saving…" : "Record decision"}
          </button>
        </form>
      )}
    </section>
  );
}

export default function RunDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rerunMessage, setRerunMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Run>(`/runs/${id}`)
      .then(setRun)
      .catch((e: ApiError) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // FR-17 "Running": poll until the runner finishes the run.
  useEffect(() => {
    if (run?.verdict !== "running") return;
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [run?.verdict, load]);

  // FR-21: Markdown bug report — name, steps, environment, commit, evidence link.
  async function copyReport() {
    if (!run) return;
    const evidenceUrl = `${location.origin}/runs/${run.id}`;
    const problems = (run.tests ?? []).filter((t) => t.status !== "passed");
    const lines = [
      `## Auto Tester run ${run.id.slice(0, 8)} — ${VERDICT_LABEL[run.verdict] ?? run.verdict}`,
      "",
      `- **Branch:** ${run.branch} @ ${run.commit_sha?.slice(0, 8) ?? "unknown"}`,
      `- **Environment:** ${run.environment} · trigger: ${run.trigger}`,
      `- **Tests:** ${run.passed} passed, ${run.failed} failed, ${run.flaky} flaky, ${run.skipped} skipped (of ${run.total})`,
      `- **Evidence:** ${evidenceUrl}`,
      "",
      ...problems.flatMap((t) => [
        `### ${t.status.toUpperCase()} · ${t.name}`,
        `- Feature: ${t.feature ?? "—"} · Priority: ${t.priority}${t.owner ? ` · Owner: ${t.owner}` : ""}`,
        `- Steps: in e2e/ run \`npx playwright test -g "${t.name}"\` against staging`,
        ...(t.error ? [`- Error: ${t.error.split("\n")[0]}`] : []),
        ...(t.screenshot_url ? [`- Screenshot: ${new URL(t.screenshot_url, location.origin).href}`] : []),
        "",
      ]),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // FR-14
  async function rerun() {
    if (!run) return;
    setRerunMessage(null);
    try {
      await apiPost(`/runs/${run.id}/rerun`, {});
      setRerunMessage("Re-run requested. A new Running row appears on the dashboard within a minute.");
    } catch (err) {
      setRerunMessage((err as ApiError).message);
    }
  }

  if (error) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-400">{error}</p>
      </main>
    );
  }
  if (!run) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-muted">Loading run…</p>
      </main>
    );
  }

  const tests = run.tests ?? [];
  const failing = tests.filter((t) => t.status === "failed" || t.status === "error");
  const flaky = tests.filter((t) => t.status === "flaky");

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 flex flex-col gap-6">
      <div className="flex items-center gap-3 text-sm text-muted">
        <Link href="/" className="hover:text-foreground">
          ← Dashboard
        </Link>
        <span>/</span>
        <span className="font-mono">{run.id.slice(0, 8)}</span>
      </div>

      {/* Summary bar — FR-19 */}
      <div className="rounded-2xl border border-border bg-panel/80 p-5 shadow-lg shadow-black/20 flex flex-wrap items-center gap-x-8 gap-y-3">
        <StatusBadge verdict={run.verdict} />
        <div className="text-sm">
          <span className="text-emerald-400 font-medium">{run.passed}</span>
          <span className="text-muted"> passed</span>
        </div>
        <div className="text-sm">
          <span className={run.failed > 0 ? "text-red-400 font-medium" : "text-muted"}>{run.failed}</span>
          <span className="text-muted"> failed</span>
        </div>
        <div className="text-sm">
          <span className={run.flaky > 0 ? "text-amber-400 font-medium" : "text-muted"}>{run.flaky}</span>
          <span className="text-muted"> flaky</span>
        </div>
        <div className="text-sm text-muted">
          {run.total} tests · {duration(run.duration_ms)}
        </div>
        <div className="text-sm text-muted font-mono">
          {run.branch} @ {run.commit_sha?.slice(0, 8) ?? "unknown"} · {run.trigger}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={rerun}
            disabled={run.verdict === "running"}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent transition-colors disabled:opacity-50"
          >
            Re-run
          </button>
          <button
            onClick={copyReport}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent transition-colors"
          >
            {copied ? "Copied ✓" : "Copy bug report"}
          </button>
        </div>
      </div>

      {rerunMessage && <p className="text-sm text-muted">{rerunMessage}</p>}
      {run.commit_message && <p className="text-sm text-muted">{run.commit_message}</p>}
      {run.verdict === "running" && (
        <p className="text-sm text-sky-300">Tests are running on GitHub Actions. This page refreshes itself.</p>
      )}

      {failing.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 text-red-400">
            {failing.length} failing test{failing.length > 1 ? "s" : ""}
          </h2>
          <TestTable tests={failing} />
        </section>
      )}

      {/* FR-20: flaky tests apart from failures, with owners */}
      {flaky.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-1 text-amber-400">
            {flaky.length} flaky test{flaky.length > 1 ? "s" : ""}
          </h2>
          <p className="mb-3 text-sm text-muted">
            Failed, then passed on retry. Not blocking the release — the owner should stabilise it.
          </p>
          <TestTable tests={flaky} />
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">All tests ({tests.length})</h2>
        {tests.length === 0 ? (
          <p className="rounded-xl border border-border bg-panel p-6 text-muted">
            {run.verdict === "running" ? "Waiting for results…" : "This run reported no tests."}
          </p>
        ) : (
          <TestTable tests={tests} />
        )}
      </section>

      <SignoffPanel run={run} onChanged={load} />
    </main>
  );
}
