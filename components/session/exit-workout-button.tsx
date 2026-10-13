"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// The way out of a workout without choosing: leaving PAUSES it. Everything already logged is saved, and "Resume workout" picks it up again (a paused workout is stored as the session state
// the app has always had for a workout that was left, shown as Paused, never counted as skipped). The real choice (complete or pause) is the Complete workout button.
export function ExitWorkoutButton({ sessionId, backHref }: { sessionId: string; backHref: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function handleLeave() {
    if (leaving) return;
    setLeaving(true);
    const supabase = createBrowserClient();
    await supabase.from("athlete_sessions").update({ status: "abandoned" }).eq("id", sessionId).eq("status", "in_progress");
    router.push(backHref);
  }

  return (
    <button type="button" onClick={handleLeave} disabled={leaving} className="font-body text-xs text-steel uppercase tracking-wide active:text-rust min-h-9">
      &larr; Back
    </button>
  );
}
