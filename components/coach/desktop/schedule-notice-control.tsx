"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// How much notice a client must give before pausing, freezing or ending their weekly schedule (days; 0 = none), and optionally the coach's own words for the client to read. Saved when the
// coach leaves a field. The database refuses a request for a sooner date and says the earliest day in plain words.
export function ScheduleNoticeControl({ coachId, initialDays, initialText }: { coachId: string; initialDays: number; initialText: string }) {
  const [days, setDays] = useState(String(initialDays));
  const [savedDays, setSavedDays] = useState(initialDays);
  const [text, setText] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const n = days.trim() === "" ? 0 : Number(days);
    if (!Number.isInteger(n) || n < 0 || n > 60) {
      setError("Notice: enter a whole number of days from 0 to 60.");
      setDays(String(savedDays));
      return;
    }
    const words = text.trim().slice(0, 200);
    if (n === savedDays && words === savedText.trim()) return;
    setError(null);
    setStatus("saving");
    const { error: saveError } = await createBrowserClient().from("coach_booking_policies").upsert(
      { coach_id: coachId, schedule_change_notice_days: n, schedule_change_notice_text: words || null },
      { onConflict: "coach_id" }
    );
    if (saveError) {
      setStatus("idle");
      setError("That didn't save. Nothing was changed. Check your connection and try again.");
      return;
    }
    setSavedDays(n);
    setSavedText(words);
    setDays(String(n));
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-4 mb-6 max-w-md">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Notice to pause or end a weekly schedule</p>
      <p className="font-body text-xs text-steel mb-2">A client who asks to pause, freeze or end their weekly schedule has to pick a day at least this many days from now. 0 means no notice is needed.</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={60}
          aria-label="Days of notice to pause or end a weekly schedule"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          onBlur={save}
          className="w-24 h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
        />
        <span className="font-body text-sm text-steel">days</span>
      </div>
      <label className="block mt-3 font-body text-xs text-steel">
        Your words for the client (optional)
        <input
          type="text"
          maxLength={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          placeholder="e.g. I ask for two weeks so I can offer your spot to someone on my waitlist."
          className="mt-1 block w-full h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
        />
      </label>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
      {status === "saving" && <p className="font-body text-xs text-steel mt-2">Saving…</p>}
      {status === "saved" && (
        <p className="font-body text-xs text-chalk mt-2" role="status">
          Saved
        </p>
      )}
    </div>
  );
}
