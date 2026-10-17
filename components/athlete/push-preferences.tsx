"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "am" : "pm"}`;

// Two choices about what reaches the phone: quiet hours (nothing is pushed between the two hours; the notice is still in the app) and private lock screens (the phone shows only "You have a new notification").
// Saved on the person's own profile, as they choose.
export function PushPreferences({ profileId, initialStart, initialEnd, initialGeneric, available }: { profileId: string; initialStart: number | null; initialEnd: number | null; initialGeneric: boolean; available: boolean }) {
  const [start, setStart] = useState<number | null>(initialStart);
  const [end, setEnd] = useState<number | null>(initialEnd);
  const [generic, setGeneric] = useState(initialGeneric);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!available) return null;

  async function save(next: { start: number | null; end: number | null; generic: boolean }, previous: { start: number | null; end: number | null; generic: boolean }) {
    setSaving(true);
    setNote(null);
    const { error } = await createBrowserClient().from("profiles").update({ quiet_hours_start: next.start, quiet_hours_end: next.end, generic_push_text: next.generic }).eq("id", profileId);
    setSaving(false);
    if (error) {
      setStart(previous.start);
      setEnd(previous.end);
      setGeneric(previous.generic);
      setNote("Couldn't save that. Try again.");
      return;
    }
    setNote("Saved.");
  }

  const quietOn = start !== null && end !== null;
  const select = "h-11 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-base sm:text-sm";

  return (
    <div className="pt-4 border-t border-steel/20 mt-4">
      <label className="flex items-start gap-3 font-body text-sm text-chalk">
        <input
          type="checkbox"
          checked={quietOn}
          disabled={saving}
          onChange={(e) => {
            const prev = { start, end, generic };
            const next = e.target.checked ? { start: 22, end: 6, generic } : { start: null, end: null, generic };
            setStart(next.start);
            setEnd(next.end);
            void save(next, prev);
          }}
          className="mt-1"
        />
        <span>
          Quiet hours
          <span className="block text-xs text-steel">No notifications are sent to your phone during these hours. They are still waiting for you in the app.</span>
        </span>
      </label>
      {quietOn && (
        <div className="flex flex-wrap items-center gap-2 mt-2 ml-7">
          <select aria-label="Quiet hours start" value={start ?? 22} disabled={saving} onChange={(e) => { const prev = { start, end, generic }; const s = Number(e.target.value); setStart(s); void save({ start: s, end, generic }, prev); }} className={select}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
          <span className="font-body text-xs text-steel">until</span>
          <select aria-label="Quiet hours end" value={end ?? 6} disabled={saving} onChange={(e) => { const prev = { start, end, generic }; const v = Number(e.target.value); setEnd(v); void save({ start, end: v, generic }, prev); }} className={select}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </div>
      )}

      <label className="flex items-start gap-3 font-body text-sm text-chalk mt-4">
        <input
          type="checkbox"
          checked={generic}
          disabled={saving}
          onChange={(e) => {
            const prev = { start, end, generic };
            setGeneric(e.target.checked);
            void save({ start, end, generic: e.target.checked }, prev);
          }}
          className="mt-1"
        />
        <span>
          Private lock screen
          <span className="block text-xs text-steel">Your phone shows &ldquo;You have a new notification&rdquo; instead of names and details.</span>
        </span>
      </label>
      {note && (
        <p className="font-body text-xs text-steel mt-2" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
