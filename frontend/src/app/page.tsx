"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, ApiError } from "@/lib/api";
import type { Project, Run } from "@/lib/types";
import { duration, timeAgo } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import ConnectProjectDialog from "@/components/ConnectProjectDialog";

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(() => {
    Promise.all([apiGet<Project[]>("/projects"), apiGet<Run[]>("/runs")])
      .then(([p, r]) => {
        setProjects(p);
        setRuns(r);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // FR-17 "Running": refresh while any run is still in progress.
  useEffect(() => {
    if (!runs?.some((r) => r.verdict === "running")) return;
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [runs, load]);

  if (error) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-400">{error}</p>
      </main>
    );
  }
  if (projects === null || runs === null) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-muted">Loading runs…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Is this safe to release?</h1>
          <p className="mt-1.5 text-muted">Staging smoke runs, verdicts and failure evidence — in one place.</p>
        </div>
        <div className="flex items-center gap-3">
          {runs.length > 0 && runs[0].verdict && <StatusBadge verdict={runs[0].verdict} />}
          <button
            onClick={() => setConnecting(true)}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400"
          >
            Connect project
          </button>
        </div>
      </div>

      <ConnectProjectDialog open={connecting} onClose={() => setConnecting(false)} onCreated={load} />

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted mb-3">Projects</h2>
        {projects.length === 0 ? (
          <p className="rounded-2xl border border-border bg-panel/80 p-6 text-muted">
            No projects connected yet. Click <strong className="text-foreground">Connect project</strong> to add
            Zedu, then store the key it gives you in GitHub.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={project.last_run ? `/runs/${project.last_run.id}` : "#"}
                className="group rounded-2xl border border-border bg-panel/80 p-5 shadow-lg shadow-black/20 transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-accent/10"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium">{project.name}</h3>
                  {project.last_run && <StatusBadge verdict={project.last_run.verdict} />}
                </div>
                <p className="mt-2 truncate text-sm text-muted">
                  {project.repo_url ?? "No repository"} · {project.branch}
                </p>
                <p className="mt-1 text-sm text-muted">Last run: {timeAgo(project.last_run?.created_at)}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted mb-3">Run history</h2>
        {runs.length === 0 ? (
          <p className="rounded-2xl border border-border bg-panel/80 p-6 text-muted">
            No runs yet. Post results from GitHub Actions to see them here.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-panel/40 shadow-lg shadow-black/20">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-medium">Verdict</th>
                  <th className="px-4 py-3 font-medium">Run</th>
                  <th className="px-4 py-3 font-medium">Branch</th>
                  <th className="px-4 py-3 font-medium">Commit</th>
                  <th className="px-4 py-3 font-medium">Trigger</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Tests</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-border/60 last:border-0 hover:bg-panel/70 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/runs/${run.id}`}>
                        <StatusBadge verdict={run.verdict} />
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/runs/${run.id}`} className="hover:text-accent">
                        {run.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{run.branch}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {run.commit_sha ? run.commit_sha.slice(0, 8) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">{run.trigger}</td>
                    <td className="px-4 py-3 text-muted">{run.status}</td>
                    <td className="px-4 py-3">
                      <span className="text-emerald-400">{run.passed}</span>
                      <span className="text-muted"> passed · </span>
                      <span className={run.failed > 0 ? "text-red-400" : "text-muted"}>{run.failed} failed</span>
                      {run.flaky > 0 && <span className="text-amber-400"> · {run.flaky} flaky</span>}
                      <span className="text-muted"> ({run.total})</span>
                    </td>
                    <td className="px-4 py-3 text-muted">{duration(run.duration_ms)}</td>
                    <td className="px-4 py-3 text-muted">{timeAgo(run.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
