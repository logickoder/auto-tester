"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, ApiError } from "@/lib/api";
import type { TestCatalogItem } from "@/lib/types";
import { timeAgo } from "@/lib/format";

const RESULT_STYLES: Record<string, string> = {
  passed: "text-emerald-400",
  failed: "text-red-400",
  error: "text-red-400",
  flaky: "text-amber-400",
  skipped: "text-muted",
};

export default function TestsPage() {
  const [items, setItems] = useState<TestCatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<TestCatalogItem[]>("/tests")
      .then(setItems)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  if (error) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-400">{error}</p>
      </main>
    );
  }
  if (!items) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-muted">Loading tests…</p>
      </main>
    );
  }

  const enabled = items.filter((t) => t.enabled !== false).length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Starter tests</h1>
        <p className="mt-1.5 text-muted">
          {items.length} tests · {enabled} enabled. This list is read-only: edit{" "}
          <code className="text-accent">e2e/manifest.json</code> and add a spec to change it.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-border bg-panel/80 p-6 text-muted">
          No tests yet. Add entries to the manifest and run the smoke workflow once.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-panel/40 shadow-lg shadow-black/20">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Enabled</th>
                <th className="px-4 py-3 font-medium">Test</th>
                <th className="px-4 py-3 font-medium">Feature</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Last result</th>
                <th className="px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.name} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={t.enabled ?? true}
                      disabled
                      readOnly
                      aria-label={`${t.name} enabled`}
                      title={t.enabled === null ? "Not in the manifest" : "Read-only: edit e2e/manifest.json"}
                      className="accent-amber-500"
                    />
                  </td>
                  <td className="px-4 py-3">{t.name}</td>
                  <td className="px-4 py-3 text-muted">{t.feature ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{t.priority}</td>
                  <td className="px-4 py-3 text-muted">{t.owner ?? "—"}</td>
                  <td
                    className={`px-4 py-3 text-xs font-medium uppercase ${
                      RESULT_STYLES[t.last_status ?? ""] ?? "text-muted"
                    }`}
                  >
                    {t.last_run_id ? (
                      <Link href={`/runs/${t.last_run_id}`} className="hover:underline">
                        {t.last_status}
                      </Link>
                    ) : (
                      "never run"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{timeAgo(t.last_run_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
