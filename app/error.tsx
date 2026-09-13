"use client";

import { useEffect } from "react";
import Link from "next/link";

// Next.js's route-segment error boundary — catches an unhandled error
// anywhere below the root layout and renders this instead of a raw stack
// trace or a blank white screen. Deliberately generic (no coach/athlete
// branching): an error boundary is the one place in this app that can't
// assume anything about who's looking at it or what page they were on.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // No error-reporting service wired up yet (Sentry or similar) — this
    // at least lands in Vercel's own function logs so it isn't silently
    // lost, and the digest lets a specific occurrence be found there.
    console.error("Unhandled app error:", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <h1 className="font-display uppercase text-2xl tracking-wide mb-2">
          Something went wrong
        </h1>
        <p className="font-body text-sm text-steel mb-6">
          That&apos;s on us, not you — nothing you were doing caused this. Try
          again, or head back and pick up from there.
        </p>
        {error.digest && (
          <p className="font-body text-[11px] text-steel/60 mb-6">
            Reference: {error.digest}
          </p>
        )}
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={reset}
            className="h-10 px-5 bg-rust text-graphite font-body text-sm font-medium"
          >
            Try again
          </button>
          <Link href="/" className="font-body text-sm text-steel active:text-rust">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
