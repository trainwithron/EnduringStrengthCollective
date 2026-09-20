"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// The plain "seen it" action from habit_spotter_and_post_workout_coach_
// page_research_sept19.md — same shape as every other Spotter's
// dismiss, so this doesn't keep resurfacing once a coach has read it.
export function AcknowledgeSessionPatternNoteButton({ checkId }: { checkId: string }) {
  const router = useRouter();
  const [acknowledging, setAcknowledging] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function handleAcknowledge() {
    setAcknowledging(true);
    const supabase = createBrowserClient();
    await supabase
      .from("session_pattern_checks")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", checkId);
    setAcknowledged(true);
    setAcknowledging(false);
    router.refresh();
  }

  if (acknowledged) {
    return <p className="font-body text-sm text-steel">✓ Acknowledged</p>;
  }

  return (
    <button
      type="button"
      onClick={handleAcknowledge}
      disabled={acknowledging}
      className="h-10 px-4 border border-steel/30 text-steel font-body text-sm disabled:opacity-50 active:text-chalk"
    >
      Acknowledge
    </button>
  );
}
