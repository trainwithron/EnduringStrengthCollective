"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function AssignSlotButton({
  coachId,
  athleteId,
  groupId,
  startAt,
  endAt,
}: {
  coachId: string;
  athleteId: string;
  groupId: string;
  startAt: string;
  endAt: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleAssign() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();

    // Same atomic RPC book-slot-button.tsx uses. A coach assigning a
    // session doesn't need the client to already have a credit (they can
    // assign a courtesy session), but still gets the real overlap guard.
    const { error: bookError } = await supabase.rpc("book_session", {
      p_coach_id: coachId,
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_start_at: startAt,
      p_end_at: endAt,
    });

    if (bookError) {
      setError(
        bookError.message.includes("just taken")
          ? "That slot was just taken. Try another."
          : "Couldn't assign that slot."
      );
      setSubmitting(false);
      router.refresh();
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleAssign}
        disabled={submitting}
        className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
      >
        {submitting ? "Assigning…" : "Assign"}
      </button>
      {error && <span className="font-body text-[11px] text-rust">{error}</span>}
    </div>
  );
}
