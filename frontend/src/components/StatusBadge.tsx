import type { Verdict } from "@/lib/types";

const STYLES: Record<Verdict, { label: string; className: string; dot: string }> = {
  ready: {
    label: "Ready",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 shadow-emerald-500/20",
    dot: "bg-emerald-400",
  },
  ready_with_warnings: {
    label: "Ready with warnings",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-amber-500/20",
    dot: "bg-amber-400",
  },
  not_ready: {
    label: "Not Ready",
    className: "bg-red-500/15 text-red-300 border-red-500/40 shadow-red-500/20",
    dot: "bg-red-400",
  },
  running: {
    label: "Running",
    className: "bg-sky-500/15 text-sky-300 border-sky-500/40 shadow-sky-500/20",
    dot: "bg-sky-400 animate-pulse",
  },
  error: {
    label: "Error",
    className: "bg-red-500/15 text-red-300 border-red-500/40 shadow-red-500/20",
    dot: "bg-red-400",
  },
};

export default function StatusBadge({ verdict }: { verdict: Verdict | null | undefined }) {
  const style = STYLES[verdict ?? "running"];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium shadow-sm ${style.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
