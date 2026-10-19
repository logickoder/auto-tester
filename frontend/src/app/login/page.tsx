"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient, supabaseConfigured } from "@/lib/supabase/client";
import { Logo } from "@/components/Navbar";
import { DemoRunCard, GoogleIcon } from "@/components/LoginVisuals";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const authError = searchParams.get("error");
  const [error, setError] = useState<string | null>(
    authError === "auth" ? "Google sign-in did not complete. Please try again." : null
  );
  const [loading, setLoading] = useState(false);

  async function signInWithGoogle() {
    if (!supabaseConfigured) {
      setError("Login is not configured yet — set the Supabase env variables first.");
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
    // On success the browser redirects to Google; no state update needed.
  }

  return (
    <div className="relative grid w-full max-w-6xl items-start gap-10 lg:grid-cols-[1.1fr_0.9fr]">
      {/* Left — pitch + live preview */}
      <div className="min-w-0 pt-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Zedu pre-release gate · staging smoke runs
        </div>
        <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
          Ship only when it&rsquo;s{" "}
          <span className="text-amber-400">
            safe to release.
          </span>
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-muted">
          Auto Tester turns every staging run into a single verdict — so you know whether a build
          is safe to ship without reading a single log.
        </p>

        <div className="mt-8">
          <DemoRunCard />
        </div>
      </div>

      {/* Right — sign-in card */}
      <div className="relative mx-auto w-full max-w-md">
        <div className="relative rounded-3xl border border-white/10 bg-[#171310] p-8 shadow-2xl shadow-black/60 sm:p-10">
          <div className="flex items-center gap-3">
            <Logo size="md" />
            <div>
              <p className="font-semibold leading-tight">Auto Tester</p>
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted">Sign in to continue</p>
            </div>
          </div>

          <h2 className="mt-8 text-2xl font-semibold tracking-tight">Welcome back</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Sign in with your Google account to see live verdicts, run history and failure evidence.
          </p>

          <button
            onClick={signInWithGoogle}
            disabled={loading}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-4 text-[15px] font-semibold text-zinc-900 shadow-lg shadow-black/40 transition-all hover:-translate-y-0.5 hover:bg-zinc-100 hover:shadow-xl active:translate-y-0 disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800" />
            ) : (
              <GoogleIcon />
            )}
            {loading ? "Redirecting to Google…" : "Continue with Google"}
          </button>

          {error && (
            <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm leading-relaxed text-red-300">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-12 lg:py-16">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
