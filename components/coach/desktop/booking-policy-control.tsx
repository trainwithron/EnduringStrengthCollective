"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

type Values = {
  cancellationHours: number;
  bufferMinutes: number;
  minimumNoticeHours: number;
  creditExpiryDays: number;
};

// Limits so a typo (an extra zero) cannot lock clients out or expire their sessions.
const LIMITS = {
  cancellationHours: { max: 720, label: "Cancellation window" },
  bufferMinutes: { max: 240, label: "Buffer" },
  minimumNoticeHours: { max: 720, label: "Minimum notice" },
  creditExpiryDays: { max: 3650, label: "Session expiration" },
} as const;

export function BookingPolicyControl({
  coachId,
  initialCancellationHours,
  initialBufferMinutes,
  initialMinimumNoticeHours,
  initialCreditExpiryDays,
}: {
  coachId: string;
  initialCancellationHours: number;
  initialBufferMinutes: number;
  initialMinimumNoticeHours: number;
  initialCreditExpiryDays: number;
}) {
  // What is saved, and what is being typed. A field is saved when the coach leaves it (or presses Enter), never on each keystroke: typing
  // "24" used to save "2" first, which for the expiry setting would have briefly told the nightly job to expire sessions after 2 days.
  const [saved, setSaved] = useState<Values>({
    cancellationHours: initialCancellationHours,
    bufferMinutes: initialBufferMinutes,
    minimumNoticeHours: initialMinimumNoticeHours,
    creditExpiryDays: initialCreditExpiryDays,
  });
  const [draft, setDraft] = useState<Record<keyof Values, string>>({
    cancellationHours: String(initialCancellationHours),
    bufferMinutes: String(initialBufferMinutes),
    minimumNoticeHours: String(initialMinimumNoticeHours),
    creditExpiryDays: String(initialCreditExpiryDays),
  });
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function commit(key: keyof Values) {
    const raw = draft[key].trim();
    const n = raw === "" ? 0 : Number(raw);
    const limit = LIMITS[key];
    if (!Number.isInteger(n) || n < 0 || n > limit.max) {
      setError(`${limit.label}: enter a whole number from 0 to ${limit.max}.`);
      setDraft((d) => ({ ...d, [key]: String(saved[key]) }));
      return;
    }
    setDraft((d) => ({ ...d, [key]: String(n) }));
    if (n === saved[key]) return;
    setError(null);
    setStatus("saving");
    const next = { ...saved, [key]: n };
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase.from("coach_booking_policies").upsert(
      {
        coach_id: coachId,
        cancellation_window_hours: next.cancellationHours,
        buffer_minutes: next.bufferMinutes,
        minimum_notice_hours: next.minimumNoticeHours,
        credit_expiry_days: next.creditExpiryDays,
      },
      { onConflict: "coach_id" }
    );
    if (saveError) {
      setStatus("idle");
      setError("That didn't save. Nothing was changed. Check your connection and try again.");
      setDraft((d) => ({ ...d, [key]: String(saved[key]) }));
      return;
    }
    setSaved(next);
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  }

  const field = (key: keyof Values, ariaLabel: string) => (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={LIMITS[key].max}
      aria-label={ariaLabel}
      value={draft[key]}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      onBlur={() => commit(key)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
      }}
      className="w-24 h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
    />
  );

  return (
    <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-4 mb-6 max-w-md space-y-4">
      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Cancellation policy</p>
        <p className="font-body text-xs text-steel mb-2">
          A client who cancels or reschedules within this many hours of their session is flagged to you, and you choose whether it counts as a session (Charge or Waive). Nothing is taken automatically.
        </p>
        <div className="flex items-center gap-2">
          {field("cancellationHours", "Hours before the session")}
          <span className="font-body text-sm text-steel">hours before the session</span>
        </div>
      </div>

      <div className="border-t border-steel/15 pt-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Buffer between sessions</p>
        <p className="font-body text-xs text-steel mb-2">
          Blocks a client from booking a session that starts too close to another one already on your
          calendar — real recovery/travel time between sessions.
        </p>
        <div className="flex items-center gap-2">
          {field("bufferMinutes", "Minutes before and after each session")}
          <span className="font-body text-sm text-steel">minutes before and after each session</span>
        </div>
      </div>

      <div className="border-t border-steel/15 pt-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Minimum booking notice</p>
        <p className="font-body text-xs text-steel mb-2">
          A client can&apos;t book a session starting sooner than this — doesn&apos;t apply when you book a
          session for a client yourself.
        </p>
        <div className="flex items-center gap-2">
          {field("minimumNoticeHours", "Hours of advance notice required")}
          <span className="font-body text-sm text-steel">hours of advance notice required</span>
        </div>
      </div>

      <div className="border-t border-steel/15 pt-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Session expiration</p>
        <p className="font-body text-xs text-steel mb-2">
          A client&apos;s unused sessions expire this many days after their most recent purchase or top-up. Set to 0 to never expire.
        </p>
        <div className="flex items-center gap-2">
          {field("creditExpiryDays", "Days until unused sessions expire")}
          <span className="font-body text-sm text-steel">days, 0 = never</span>
        </div>
      </div>

      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
      {status === "saving" && <p className="font-body text-xs text-steel">Saving…</p>}
      {status === "saved" && (
        <p className="font-body text-xs text-chalk" role="status">
          Saved
        </p>
      )}
    </div>
  );
}
