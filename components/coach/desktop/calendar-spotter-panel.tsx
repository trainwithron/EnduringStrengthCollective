"use client";

import { useState } from "react";
import Link from "next/link";
import type { CalendarSpotterFinding } from "@/lib/calendar-spotter-gather";
import { buildComeBackDraft } from "@/lib/attendance-draft";
import { ATTENDANCE_LONG_SNOOZE_DAYS, attendancePatternKey, attendanceCheckKind } from "@/lib/calendar-spotter-dismiss";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";

// scheduling_calendar_spotter_idea.md — "Calendar Spot: [content]" source-
// label convention (resolved directly with Ron): a label prefix is pure
// attribution, never reads as bragging, so it's present on every finding
// uniformly. The gap/flaky findings stay plain fact; the recovery finding
// is the one place body copy earns a benefit-framed line, per the same
// memory's resolved branding note — same taste discipline as coach_
// perceived_value_design_principle.md, just with more room to let the
// software take credit since the coach (not the athlete) is the audience.
//
// Every row can be put away (Ron, Oct 6): "Not now" keeps it quiet for 2 weeks, "Don't flag {name}" for 60 days; neither changes anything about the client.
// A client with a session coming up has it right on the row, with the existing cancel (a coach cancel gives back anything charged for it).
export function CalendarSpotterPanel({
  findings,
  groupId,
  timezone,
}: {
  findings: CalendarSpotterFinding[];
  groupId?: string;
  timezone?: string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = findings.filter((f) => !hidden.has(`${f.athleteId}::${f.kind}`));
  if (visible.length === 0) return null;

  async function putAway(f: CalendarSpotterFinding, long: boolean) {
    setBusyId(`${f.athleteId}::${f.kind}`);
    setError(null);
    const res = await fetch("/api/calendar-spotter/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkKind: attendanceCheckKind,
        patternKey: attendancePatternKey(f.athleteId, f.kind),
        headline: f.message,
        action: "denied",
        detail: long ? String(ATTENDANCE_LONG_SNOOZE_DAYS) : undefined,
      }),
    });
    setBusyId(null);
    if (!res.ok) {
      setError("That didn't save. Try again.");
      return;
    }
    setHidden((prev) => new Set(prev).add(`${f.athleteId}::${f.kind}`));
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(timezone ? { timeZone: timezone } : {}) });

  return (
    <div className="border border-rust/40 bg-rust/5 p-4">
      <p className="font-body text-xs text-rust uppercase tracking-wide font-medium mb-2">Calendar Spot</p>
      <div className="space-y-3">
        {visible.map((f) => {
          const id = `${f.athleteId}::${f.kind}`;
          const first = f.athleteName.split(" ")[0] ?? "";
          return (
            <div key={id}>
              <div className="flex items-start gap-2">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${f.kind === "recovery" ? "bg-moss" : "bg-rust"}`} />
                <p className="font-body text-sm text-chalk flex-1">{f.message}</p>
                {f.kind === "gap" && groupId && (
                  <Link
                    href={`/groups/${groupId}/messages/${f.athleteId}?draft=${encodeURIComponent(buildComeBackDraft(first))}`}
                    className="shrink-0 h-9 px-3 border border-rust text-rust font-body text-xs inline-flex items-center"
                  >
                    Send a note
                  </Link>
                )}
              </div>
              <div className="ml-3.5 mt-1.5 flex flex-wrap items-center gap-2">
                {f.nextBooking && (
                  <span className="inline-flex items-center gap-2 font-body text-xs text-steel">
                    Next session {fmt(f.nextBooking.startAt)}
                    <CancelBookingButton
                      bookingId={f.nextBooking.id}
                      rescheduleHref={groupId ? `/groups/${groupId}/calendar` : "/dashboard"}
                      recurringSeriesId={f.nextBooking.recurringSeriesId}
                      viewer="coach"
                    />
                  </span>
                )}
                <button
                  type="button"
                  disabled={busyId === id}
                  onClick={() => putAway(f, false)}
                  className="h-9 px-3 border border-steel/30 text-steel font-body text-xs disabled:opacity-50"
                >
                  Not now
                </button>
                <button
                  type="button"
                  disabled={busyId === id}
                  onClick={() => putAway(f, true)}
                  className="h-9 px-3 border border-steel/30 text-steel font-body text-xs disabled:opacity-50"
                >
                  Don&apos;t flag {first || "them"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
