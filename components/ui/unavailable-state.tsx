"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// For a list or section whose data failed to load. An empty state ("No
// programs assigned") is a statement about the person's data; showing it when
// the query merely failed tells them something false. This says what happened
// and gives them a way to try again.
export function UnavailableState({
  what,
  compact = false,
}: {
  // What could not be loaded, in plain words: "your programs", "this roster".
  what: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tried, setTried] = useState(false);

  return (
    <div
      role="alert"
      className={`border border-steel/30 bg-surface/60 ${compact ? "px-3 py-3" : "px-4 py-5"} font-body`}
    >
      <p className="text-sm text-chalk">We couldn&apos;t load {what} just now.</p>
      <p className="text-xs text-steel mt-1">
        {tried
          ? "Still not working. Check your connection, then try again in a moment."
          : "This is a loading problem, not missing data. Nothing was changed."}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setTried(true);
          startTransition(() => router.refresh());
        }}
        className="h-11 px-5 mt-3 bg-rust text-graphite text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Trying…" : "Try again"}
      </button>
    </div>
  );
}
