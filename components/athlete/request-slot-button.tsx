"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// In "Clients request, I confirm" mode the client asks for a time. Nothing is booked or held: the coach sees the request, confirms or declines it,
// and the client is told either way.
export function RequestSlotButton({
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
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRequest() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc("request_booking", {
      p_coach_id: coachId,
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_start_at: startAt,
      p_end_at: endAt,
    });
    setSubmitting(false);
    if (rpcError) {
      const msg = rpcError.message ?? "";
      setError(
        /already asked/.test(msg)
          ? "You already asked for this time. Your coach has not answered yet."
          : /3 requests/.test(msg)
          ? "You already have 3 requests waiting for your coach."
          : /outside your coach/.test(msg)
          ? "That time is outside your coach's hours."
          : /just taken/.test(msg)
          ? "That slot was just taken. Try another."
          : "That didn't send. Nothing was changed. Try again."
      );
      router.refresh();
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <span className="font-body text-xs text-chalk text-right max-w-[200px]">
        Requested. Your coach will confirm; you will be told either way.
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleRequest}
        disabled={submitting}
        className="h-11 px-3 border border-rust text-rust font-body text-xs font-medium disabled:opacity-40"
      >
        {submitting ? "Sending…" : "Request this time"}
      </button>
      {error && <span className="font-body text-xs text-rust text-right max-w-[200px]">{error}</span>}
    </div>
  );
}
