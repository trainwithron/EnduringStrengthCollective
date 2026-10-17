"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { resumeSession } from "@/lib/resume-session";

// Exiting a workout used to be permanent: the session was marked abandoned and
// read-only forever, so a misfire (or "I'll finish after the phone call")
// meant redoing the whole thing. Everything already logged is still there —
// this just puts the session back to in-progress.
export function ResumeWorkoutButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResume() {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { resumed } = await resumeSession(supabase, sessionId);
    if (!resumed) {
      setBusy(false);
      setError("Couldn't resume — check your connection and try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleResume}
        disabled={busy}
        className="w-full h-12 bg-rust text-graphite font-display uppercase text-base font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
      >
        {busy ? "Resuming…" : "Resume workout"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
