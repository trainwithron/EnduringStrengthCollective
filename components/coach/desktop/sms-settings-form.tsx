"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// The single opt-in/quiet-hours gate every SMS trigger in this app
// reads (lib/sms-dispatch.ts) — session reminders, booking
// confirmations, attendance nudges, and the low-credit mirror all stay
// silent for this coach until sms_enabled is true here. One master
// switch, not a per-feature toggle for each of the four message types
// — matches coach_ease_of_use_design_principle.md's "minimize
// configuration time" rule; a coach who wants SMS at all almost
// certainly wants all four, and the four are few enough to reason
// about without individual switches.
export function SmsSettingsForm({
  coachId,
  initialPhone,
  initialSmsEnabled,
  initialQuietHoursStart,
  initialQuietHoursEnd,
}: {
  coachId: string;
  initialPhone: string | null;
  initialSmsEnabled: boolean;
  initialQuietHoursStart: string | null;
  initialQuietHoursEnd: string | null;
}) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [smsEnabled, setSmsEnabled] = useState(initialSmsEnabled);
  const [quietStart, setQuietStart] = useState(initialQuietHoursStart ?? "");
  const [quietEnd, setQuietEnd] = useState(initialQuietHoursEnd ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function persist(overrides: Partial<{ phone: string; smsEnabled: boolean; quietStart: string; quietEnd: string }> = {}) {
    setSaving(true);
    setSaved(false);
    const supabase = createBrowserClient();
    await supabase.from("coach_sms_config").upsert(
      {
        coach_id: coachId,
        phone: (overrides.phone ?? phone).trim() || null,
        sms_enabled: overrides.smsEnabled ?? smsEnabled,
        quiet_hours_start: (overrides.quietStart ?? quietStart) || null,
        quiet_hours_end: (overrides.quietEnd ?? quietEnd) || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "coach_id" }
    );
    setSaving(false);
    setSaved(true);
  }

  function handleToggle() {
    const next = !smsEnabled;
    setSmsEnabled(next);
    persist({ smsEnabled: next });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="border border-rust/40 bg-rust/5 p-3">
        <p className="font-body text-xs text-chalk">
          Real text messages cost a small amount per send (Twilio&apos;s own usage-based pricing) and
          require your own Twilio account credentials to be configured — this page controls when
          and to whom this app sends them, not whether Twilio itself is set up.
        </p>
      </div>

      <div className="flex items-center justify-between border border-steel/30 px-4 py-3">
        <div>
          <p className="font-body text-sm text-chalk">SMS notifications</p>
          <p className="font-body text-xs text-steel mt-0.5">
            Session reminders, booking confirmations, attendance nudges, and low-credit alerts.
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          className={`h-6 w-11 shrink-0 border transition-colors ${
            smsEnabled ? "bg-rust border-rust" : "bg-transparent border-steel/40"
          }`}
          aria-pressed={smsEnabled}
          aria-label="Toggle SMS notifications"
        >
          <span
            className={`block h-4 w-4 bg-chalk transition-transform ${
              smsEnabled ? "translate-x-5" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <div>
        <label className="font-body text-xs text-steel uppercase tracking-wide" htmlFor="sms-phone">
          Your phone number (for low-credit alerts sent to you)
        </label>
        <input
          id="sms-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => persist()}
          placeholder="(555) 123-4567"
          className="w-full mt-1 bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="font-body text-xs text-steel uppercase tracking-wide" htmlFor="quiet-start">
            Quiet hours start
          </label>
          <input
            id="quiet-start"
            type="time"
            value={quietStart}
            onChange={(e) => setQuietStart(e.target.value)}
            onBlur={() => persist()}
            className="w-full mt-1 bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
          />
        </div>
        <div>
          <label className="font-body text-xs text-steel uppercase tracking-wide" htmlFor="quiet-end">
            Quiet hours end
          </label>
          <input
            id="quiet-end"
            type="time"
            value={quietEnd}
            onChange={(e) => setQuietEnd(e.target.value)}
            onBlur={() => persist()}
            className="w-full mt-1 bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
          />
        </div>
      </div>
      <p className="font-body text-xs text-steel">
        No texts (to you or your clients) go out during this window, in your own timezone. Leave
        both blank for no quiet hours.
      </p>

      <p className="font-body text-xs text-steel">{saving ? "Saving…" : saved ? "Saved." : ""}</p>
    </div>
  );
}
