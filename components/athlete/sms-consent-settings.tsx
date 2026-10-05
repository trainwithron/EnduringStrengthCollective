"use client";

import { useState } from "react";
import { SMS_DISCLOSURE_TEXT, SMS_SCOPE_LABELS } from "@/lib/sms-consent";

// The client's own text-message consent: two separate, unticked-by-default
// choices tied to the number they enter here. Nothing is texted unless a
// box is ticked, and the number is the one used (changing it means opting
// in again). A STOP reply to any text turns everything off at the carrier;
// this panel then explains that START resumes it.
export function SmsConsentSettings({
  initialPhone,
  initialAppointments,
  initialAnnouncements,
  optedOut,
}: {
  initialPhone: string;
  initialAppointments: boolean;
  initialAnnouncements: boolean;
  optedOut: boolean;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const [appointments, setAppointments] = useState(initialAppointments);
  const [announcements, setAnnouncements] = useState(initialAnnouncements);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [savedPhone, setSavedPhone] = useState(initialPhone);

  // Only a STOP-blocked number that hasn't been changed stays locked.
  const locked = optedOut && phone.trim() === savedPhone.trim();

  async function save() {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sms/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, appointments, announcements }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save that — try again.");
      setSavedPhone(phone);
      setMessage({
        kind: "ok",
        text: appointments || announcements ? "Saved. You'll only get the texts you picked." : "Saved. No texts will be sent.",
      });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Couldn't save that — try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="font-body text-sm text-chalk">Text messages from your coach</p>
      <p className="font-body text-xs text-steel mt-0.5">Off unless you turn them on.</p>

      {optedOut && (
        <p className="font-body text-xs text-rust mt-2" role="status">
          You replied STOP, so texts are off for this number. Reply START to a text from us to turn them
          back on, or enter a different number below.
        </p>
      )}

      <label className="block mt-3">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">Mobile number</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 123-4567"
          className="mt-1 w-full h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
      </label>

      <div className="mt-3 space-y-3">
        {(["appointments", "announcements"] as const).map((scope) => {
          const checked = scope === "appointments" ? appointments : announcements;
          const setChecked = scope === "appointments" ? setAppointments : setAnnouncements;
          return (
            <label key={scope} className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-1 h-4 w-4 accent-rust shrink-0"
              />
              <span>
                <span className="block font-body text-sm text-chalk">{SMS_SCOPE_LABELS[scope].title}</span>
                <span className="block font-body text-xs text-steel">{SMS_SCOPE_LABELS[scope].detail}</span>
              </span>
            </label>
          );
        })}
      </div>

      <p className="font-body text-[11px] text-steel mt-3">{SMS_DISCLOSURE_TEXT}</p>

      {message && (
        <p className={`font-body text-xs mt-3 ${message.kind === "error" ? "text-rust" : "text-steel"}`} role="status">
          {message.text}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving || locked}
        className="mt-3 h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save text preferences"}
      </button>
    </div>
  );
}
