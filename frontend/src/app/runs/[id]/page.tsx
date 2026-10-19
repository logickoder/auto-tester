// Server page: params is passed into the client component inside <Suspense>
// so the route can be prerendered (Next.js 16 requirement).
import { Suspense } from "react";
import RunDetails from "./run-details";

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-5xl p-6">
          <p className="text-muted">Loading run…</p>
        </main>
      }
    >
      <RunDetails params={params} />
    </Suspense>
  );
}
