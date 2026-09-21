"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// acuity_replacement_gap_audit_sept16.md — waitlists, specific-slot
// only, soft priority (per Ron's own confirmed answer). Once the
// waitlisted slot actually frees up, the underlying booking's own
// status flips to 'cancelled' server-side and this slot simply renders
// as a normal open "Book" slot on the next load — the waitlist entry
// itself is purely a notification-priority queue, not a special
// booking state, so no separate "claim" UI is needed here.
export function WaitlistJoinButton({
  coachId,
  athleteId,
  groupId,
  slotStartAt,
  slotEndAt,
  existingStatus,
}: {
  coachId: string;
  athleteId: string;
  groupId: string;
  slotStartAt: string;
  slotEndAt: string;
  existingStatus: "waiting" | "offered" | null;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState(existingStatus);
  const router = useRouter();

  async function handleJoin() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: joinError } = await supabase.rpc("join_booking_waitlist", {
      p_coach_id: coachId,
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_slot_start_at: slotStartAt,
      p_slot_end_at: slotEndAt,
    });
    setSubmitting(false);
    if (joinError) {
      setError("Couldn't join the waitlist.");
      return;
    }
    setLocalStatus("waiting");
    router.refresh();
  }

  async function handleLeave() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: leaveError } = await supabase
      .from("booking_waitlist_entries")
      .update({ status: "cancelled" })
      .eq("athlete_id", athleteId)
      .eq("coach_id", coachId)
      .eq("slot_start_at", slotStartAt)
      .eq("status", "waiting");
    setSubmitting(false);
    if (leaveError) {
      setError("Couldn't leave the waitlist.");
      return;
    }
    setLocalStatus(null);
    router.refresh();
  }

  if (localStatus === "waiting" || localStatus === "offered") {
    return (
      <div className="flex items-center gap-2">
        <span className="font-body text-[11px] text-steel">On waitlist</span>
        <button
          type="button"
          onClick={handleLeave}
          disabled={submitting}
          className="font-body text-[11px] text-rust disabled:opacity-40"
        >
          {submitting ? "…" : "Leave"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleJoin}
        disabled={submitting}
        className="h-8 px-3 border border-steel/30 text-steel font-body text-xs font-medium disabled:opacity-40"
      >
        {submitting ? "Joining…" : "Join waitlist"}
      </button>
      {error && <span className="font-body text-[11px] text-rust">{error}</span>}
    </div>
  );
}
