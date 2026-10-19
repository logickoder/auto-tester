export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.2 3.7-8.6z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-6-2.1-6.9-5.1L1.2 17c2 3.7 5.7 7 10.8 7z"
      />
      <path
        fill="#FBBC05"
        d="M5.1 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3L1.2 6.7C.4 8.3 0 10.1 0 12s.4 3.7 1.2 5.3l3.9-3z"
      />
      <path
        fill="#EA4335"
        d="M12 4.6c2.3 0 3.8 1 4.7 1.8l3.4-3.3C18 1.2 15.2 0 12 0 6.9 0 3.2 3.3 1.2 6.7l3.9 3C6 6.7 8.8 4.6 12 4.6z"
      />
    </svg>
  );
}

export function DemoRunCard() {
  const rows = [
    { verdict: "Ready", branch: "main", sha: "a1b2c3d4", tests: "48 passed", tone: "emerald" },
    { verdict: "Warnings", branch: "feat/checkout", sha: "e5f6a7b8", tests: "46 passed · 2 flaky", tone: "amber" },
    { verdict: "Blocked", branch: "feat/payments", sha: "c9d0e1f2", tests: "41 passed · 3 failed", tone: "red" },
    { verdict: "Running", branch: "feat/search", sha: "8ab374f1", tests: "live…", tone: "sky" },
  ];
  const tones: Record<string, string> = {
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    red: "border-red-500/40 bg-red-500/10 text-red-300",
    sky: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  };
  const dots: Record<string, string> = {
    emerald: "bg-emerald-400",
    amber: "bg-amber-400",
    red: "bg-red-400",
    sky: "bg-sky-400 animate-pulse",
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/60">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 hidden font-mono text-xs text-muted sm:block">auto-tester — live verdicts</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> live
        </span>
      </div>
      <ul className="divide-y divide-white/5">
        {rows.map((r) => (
          <li key={r.branch} className="flex items-center gap-3 px-4 py-3">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[r.tone]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${dots[r.tone]}`} />
              {r.verdict}
            </span>
            <span className="truncate font-mono text-xs text-zinc-300">{r.branch}</span>
            <span className="hidden font-mono text-[11px] text-muted sm:block">{r.sha}</span>
            <span className="ml-auto hidden text-xs text-muted md:block">{r.tests}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
