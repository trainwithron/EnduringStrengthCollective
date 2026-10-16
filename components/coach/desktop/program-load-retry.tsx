"use client";

import { useRouter } from "next/navigation";

// Shown instead of an empty builder when the program's days could not be read just now. The program itself is untouched; this only asks again.
export const LOAD_FAILED_MESSAGE = "Couldn't load this program just now. Nothing was lost; your work is saved.";

export function ProgramLoadRetry() {
  const router = useRouter();
  return (
    <div className="border border-rust/50 p-4 max-w-xl" role="alert">
      <p className="font-body text-sm text-chalk">{LOAD_FAILED_MESSAGE}</p>
      <button type="button" onClick={() => router.refresh()} className="mt-3 min-h-11 px-5 border border-rust text-rust font-display font-bold uppercase tracking-wide">
        Try again
      </button>
    </div>
  );
}
