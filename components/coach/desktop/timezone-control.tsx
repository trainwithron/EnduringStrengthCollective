"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";

// A curated list rather than the full ~400-zone IANA database — every
// real timezone a coach running this business is actually in, without
// making them hunt through entries like "Antarctica/Casey." Anything
// missing here would need adding, not a free-text field (an invalid
// IANA string would silently make every slot computation fail).
const COMMON_TIMEZONES = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain, no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
  { value: "America/Toronto", label: "Eastern (Toronto)" },
  { value: "America/Vancouver", label: "Pacific (Vancouver)" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Berlin", label: "Central Europe (Berlin)" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "UTC", label: "UTC" },
];

export function TimezoneControl({ initialTimezone }: { initialTimezone: string | null }) {
  const [timezone, setTimezone] = useState(initialTimezone ?? DEFAULT_COACH_TIMEZONE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A coach who's never set this gets their browser's own detected zone
  // saved once, automatically — a real starting value from wherever they
  // actually are, rather than a fixed guess (DEFAULT_COACH_TIMEZONE)
  // silently misrepresenting their real hours until they happen to find
  // this control. Only runs once, only when nothing is saved yet.
  useEffect(() => {
    if (initialTimezone) return;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected) return;
    setTimezone(detected);
    persist(detected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persist(next: string) {
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ timezone: next })
      .eq("id", user.id);
    setSaving(false);
    if (updateError) {
      setError("Couldn't save — try again.");
    }
  }

  return (
    <div className="mb-4">
      <label className="block max-w-xs">
        <span className="font-body text-xs text-steel uppercase tracking-wide">
          Your timezone
        </span>
        <select
          value={timezone}
          onChange={(e) => {
            setTimezone(e.target.value);
            persist(e.target.value);
          }}
          disabled={saving}
          className="w-full h-9 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm disabled:opacity-50"
        >
          {!COMMON_TIMEZONES.some((t) => t.value === timezone) && (
            <option value={timezone}>{timezone}</option>
          )}
          {COMMON_TIMEZONES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <p className="font-body text-[11px] text-steel mt-1 max-w-[55ch]">
        Your recurring hours below are in this timezone — clients booking
        from anywhere always see the correct real time.
      </p>
      {error && <p className="font-body text-xs text-rust mt-1">{error}</p>}
    </div>
  );
}
