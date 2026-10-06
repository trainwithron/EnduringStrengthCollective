"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export interface DifferentTimeOption {
  startAt: string;
  endAt: string;
  label: string;
}

// In "Clients request, I confirm" mode the regular open times are buttons, and this is the human option beside them (Ron, Oct 6: "we can be human with one
// another, we don't have to be tied to a system"): ask for a time that is not on the list, in 5-minute steps, inside the coach's hours and clear of their
// time off and other sessions. It is an ordinary request: nothing is booked or held until the coach confirms.
export function RequestDifferentTime({
  coachId,
  athleteId,
  groupId,
  options,
  sessionMinutes,
}: {
  coachId: string;
  athleteId: string;
  groupId: string;
  options: DifferentTimeOption[];
  sessionMinutes: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sentLabel, setSentLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (options.length === 0) return null;

  async function send() {
    const picked = options.find((o) => o.startAt === choice);
    if (!picked) {
      setError("Choose a time first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("request_booking", {
      p_coach_id: coachId,
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_start_at: picked.startAt,
      p_end_at: picked.endAt,
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
          ? "That time was just taken. Try another."
          : "That didn't send. Nothing was changed. Try again."
      );
      router.refresh();
      return;
    }
    setSentLabel(picked.label);
    router.refresh();
  }

  if (sentLabel) {
    return <p className="font-body text-sm text-chalk mt-4">Asked for {sentLabel}. Your coach will confirm, and you will be told either way.</p>;
  }

  return (
    <div className="mt-4 border border-steel/20 p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="font-body text-sm text-rust min-h-11">
        Ask for a different time
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="font-body text-xs text-steel">
            Pick any time that suits you inside your coach&apos;s hours{sessionMinutes ? ` (a session is ${sessionMinutes} minutes)` : ""}. Your coach confirms it before it is booked.
          </p>
          <label className="block font-body text-xs text-steel">
            Start time
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="mt-1 w-full h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm"
            >
              <option value="">Choose a time</option>
              {options.map((o) => (
                <option key={o.startAt} value={o.startAt}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={send}
            disabled={submitting || !choice}
            className="h-11 px-4 border border-rust text-rust font-body text-sm font-medium disabled:opacity-40"
          >
            {submitting ? "Sending…" : "Ask for this time"}
          </button>
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
