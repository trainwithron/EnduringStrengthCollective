"use client";

import { useRouter } from "next/navigation";

// Shown instead of an empty page when the page's data could not be read. A failed read must never look like "nothing here yet": that tells the person their records are gone.
export const LOAD_FAILED_TEXT = "Couldn't load this. Try again.";

export function LoadFailed() {
  const router = useRouter();
  return (
    <div className="border border-rust/50 p-4 max-w-xl" role="alert">
      <p className="font-body text-sm text-chalk">{LOAD_FAILED_TEXT}</p>
      <button type="button" onClick={() => router.refresh()} className="mt-3 min-h-11 px-5 border border-rust text-rust font-display font-bold uppercase tracking-wide">
        Try again
      </button>
    </div>
  );
}
