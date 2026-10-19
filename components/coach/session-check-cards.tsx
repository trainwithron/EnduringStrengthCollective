"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";
import { checkAndNotifyLowSessionBalance } from "@/lib/notify-low-session-balance";
import { BookingDateControl } from "@/components/coach/booking-date-control";

export interface SessionToCheck {
  bookingId: string;
  athleteId: string;
  groupId: string;
  /** First name and last initial */
  name: string;
  startIso: string;
}

const SHOWN = 3;

// "Did this session happen?" (Ron, Oct 19): a session whose time has passed and that nobody marked gets a card in the app, never a push and never auto-completed. Yes marks it attended (the session comes off their balance, as
// always) and tells the client; No takes it off the calendar with nothing used; Reschedule changes its day right there. One tap each, then the card is gone. Oldest first, three at a time, with "N more".
export function SessionCheckCards({ sessions, timezone }: { sessions: SessionToCheck[]; timezone: string }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [startOverride, setStartOverride] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const left = sessions.filter((s) => !gone.has(s.bookingId));
  if (left.length === 0) return null;
  const shown = showAll ? left : left.slice(0, SHOWN);
  const when = (s: SessionToCheck) => formatInTimezone(new Date(startOverride[s.bookingId] ?? s.startIso), timezone, "dateTime");

  async function yes(s: SessionToCheck) {
    setBusy(s.bookingId);
    setErrors((e) => ({ ...e, [s.bookingId]: "" }));
    const { error } = await createBrowserClient().rpc("mark_booking_attended", { p_booking_id: s.bookingId });
    setBusy(null);
    if (error) {
      setErrors((e) => ({ ...e, [s.bookingId]: "That didn't save. Nothing was changed. Try again." }));
      return;
    }
    setGone((g) => new Set(g).add(s.bookingId));
    checkAndNotifyLowSessionBalance(s.athleteId, s.groupId);
    // The client hears it was completed (best effort; one push for this one session).
    void fetch("/api/bookings/completed-notice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: s.bookingId }), keepalive: true }).catch(() => undefined);
    router.refresh();
  }

  async function no(s: SessionToCheck) {
    setBusy(s.bookingId);
    setErrors((e) => ({ ...e, [s.bookingId]: "" }));
    const { error } = await createBrowserClient().rpc("cancel_booking_and_refund_credit", { p_booking_id: s.bookingId });
    setBusy(null);
    if (error) {
      setErrors((e) => ({ ...e, [s.bookingId]: "That didn't save. Nothing was changed. Try again." }));
      return;
    }
    mirrorGoogleCalendarEvent(s.bookingId);
    setGone((g) => new Set(g).add(s.bookingId));
    router.refresh();
  }

  return (
    <section aria-label="Sessions to check" className="mb-6 space-y-2">
      {shown.map((s) => (
        <div key={s.bookingId} className="border border-rust/50 bg-surface p-3">
          <p className="font-body text-sm text-chalk">
            Did <span className="font-semibold">{s.name}</span>&apos;s session ({when(s)}) happen?
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy === s.bookingId} onClick={() => yes(s)} className="min-h-11 px-5 bg-positive text-graphite font-display font-bold uppercase tracking-wide text-sm disabled:opacity-40">
              Yes
            </button>
            <button type="button" disabled={busy === s.bookingId} onClick={() => no(s)} className="min-h-11 px-5 border border-steel/50 text-chalk font-display font-bold uppercase tracking-wide text-sm disabled:opacity-40">
              No
            </button>
            <button
              type="button"
              disabled={busy === s.bookingId}
              aria-expanded={moving === s.bookingId}
              onClick={() => setMoving((m) => (m === s.bookingId ? null : s.bookingId))}
              className="min-h-11 px-5 border border-steel/30 text-steel font-body text-sm disabled:opacity-40"
            >
              Reschedule
            </button>
          </div>
          {moving === s.bookingId && (
            <BookingDateControl
              bookingId={s.bookingId}
              startIso={startOverride[s.bookingId] ?? s.startIso}
              timezone={timezone}
              onMoved={(iso) => {
                setStartOverride((o) => ({ ...o, [s.bookingId]: iso }));
                // moved to a day that has not happened yet: it is no longer waiting for an answer
                if (new Date(iso).getTime() > Date.now()) setGone((g) => new Set(g).add(s.bookingId));
                router.refresh();
              }}
            />
          )}
          {errors[s.bookingId] && (
            <p className="font-body text-xs text-rust mt-2" role="alert">
              {errors[s.bookingId]}
            </p>
          )}
        </div>
      ))}
      {!showAll && left.length > SHOWN && (
        <button type="button" onClick={() => setShowAll(true)} className="font-body text-sm text-rust underline underline-offset-2 min-h-11">
          {left.length - SHOWN} more
        </button>
      )}
    </section>
  );
}
