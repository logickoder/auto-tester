"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { apiPost, ApiError } from "@/lib/api";
import type { ProjectCreated } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (project: ProjectCreated) => void;
};

const EMPTY = { name: "", repo_url: "", branch: "main", staging_url: "", alert_channel: "" };

function githubSetup(apiKey: string, stagingUrl: string) {
  const apiUrl = location.origin.includes("localhost") ? "https://tester.zedu.chat" : location.origin;
  return [
    "# In the repo that runs the tests -> Settings -> Environments -> staging",
    "# Variables",
    `AUTOTESTER_API_URL=${apiUrl}`,
    `AUTOTESTER_STAGING_URL=${stagingUrl}`,
    "# Secrets",
    `AUTOTESTER_API_KEY=${apiKey}`,
    "AUTOTESTER_USER_A_EMAIL=...   AUTOTESTER_USER_A_PASSWORD=...",
    "AUTOTESTER_USER_B_EMAIL=...   AUTOTESTER_USER_B_PASSWORD=...",
    "# Workflow file: .github/workflows/smoke.yml from the auto-tester repo",
  ].join("\n");
}

export default function ConnectProjectDialog({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProjectCreated | null>(null);
  const [copied, setCopied] = useState<"key" | "setup" | null>(null);

  if (!open) return null;

  const field = (name: keyof typeof EMPTY) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [name]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.staging_url.startsWith("https://")) {
      setError("Staging URL must start with https://");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = await apiPost<ProjectCreated>("/projects", {
        name: form.name.trim(),
        repo_url: form.repo_url.trim() || null,
        branch: form.branch.trim() || "main",
        staging_url: form.staging_url.trim(),
        alert_channel: form.alert_channel.trim() || null,
      });
      setCreated(project);
      onCreated(project);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, what: "key" | "setup") {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  }

  function close() {
    setForm(EMPTY);
    setCreated(null);
    setError(null);
    onClose();
  }

  const input =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-panel p-6 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {created ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold">{created.name} is connected</h2>
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              This API key is shown <strong>once</strong>. Store it as the GitHub secret AUTOTESTER_API_KEY
              now. Only its hash is kept on the server.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-background p-3 text-xs">
                {created.api_key}
              </code>
              <button
                onClick={() => copy(created.api_key, "key")}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:border-accent"
              >
                {copied === "key" ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-medium uppercase text-muted">GitHub setup</p>
                <button
                  onClick={() => copy(githubSetup(created.api_key, created.staging_url ?? ""), "setup")}
                  className="text-xs text-accent hover:underline"
                >
                  {copied === "setup" ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 text-xs text-muted">
                {githubSetup(created.api_key, created.staging_url ?? "")}
              </pre>
            </div>
            <button
              onClick={close}
              className="self-end rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-semibold">Connect a project</h2>
              <p className="mt-1 text-sm text-muted">
                Staging only. The key you get back goes into GitHub secrets, never into code.
              </p>
            </div>
            <label className="text-sm">
              <span className="mb-1 block text-muted">Project name</span>
              <input className={input} required maxLength={120} value={form.name} onChange={field("name")} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">GitHub repository URL</span>
              <input
                className={input}
                type="url"
                placeholder="https://github.com/zedu-yodaa/zedu"
                value={form.repo_url}
                onChange={field("repo_url")}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-muted">Branch</span>
                <input className={input} value={form.branch} onChange={field("branch")} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted">Zedu alert channel (optional)</span>
                <input
                  className={input}
                  placeholder="#releases"
                  value={form.alert_channel}
                  onChange={field("alert_channel")}
                />
              </label>
            </div>
            <label className="text-sm">
              <span className="mb-1 block text-muted">Staging URL (https only)</span>
              <input
                className={input}
                type="url"
                required
                placeholder="https://staging.zedu.chat"
                value={form.staging_url}
                onChange={field("staging_url")}
              />
            </label>
            {error && (
              <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-border px-4 py-2 text-sm hover:border-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-60"
              >
                {busy ? "Saving…" : "Create project"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
