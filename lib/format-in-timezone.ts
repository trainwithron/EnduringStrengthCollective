import type { SupabaseClient } from "@supabase/supabase-js";

// Server code (cron jobs, notifications, SMS) runs in UTC on Vercel, so "toLocaleTimeString()" there tells a client
// in Phoenix their 8:00 session is at 3:00. Everything a person is TOLD about a time goes through this instead, in
// that person's own time zone. When the zone is unknown the time is shown with its zone name ("3:00 PM UTC") so it can
// never be mistaken for local time.
export type TimeStyle = "time" | "date" | "dateTime";

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function formatInTimezone(
  when: Date | string,
  timeZone: string | null | undefined,
  style: TimeStyle = "dateTime"
): string {
  const date = typeof when === "string" ? new Date(when) : when;
  const known = isValidTimeZone(timeZone);
  const opts: Intl.DateTimeFormatOptions = { timeZone: known ? timeZone : "UTC" };
  if (style === "time" || style === "dateTime") {
    opts.hour = "numeric";
    opts.minute = "2-digit";
  }
  if (style === "date" || style === "dateTime") {
    opts.weekday = "short";
    opts.month = "short";
    opts.day = "numeric";
  }
  if (!known && style !== "date") opts.timeZoneName = "short";
  return new Intl.DateTimeFormat("en-US", opts).format(date);
}

// The first valid time zone among these people's profiles, in order (the recipient first, then whoever else is
// reasonable, such as their coach), or null when none is set.
export async function timezoneForProfiles(supabase: SupabaseClient, profileIds: (string | null | undefined)[]): Promise<string | null> {
  const ids = profileIds.filter((x): x is string => !!x);
  if (ids.length === 0) return null;
  const { data } = await supabase.from("profiles").select("id, timezone").in("id", ids);
  const byId = new Map((data ?? []).map((r) => [r.id as string, (r.timezone as string | null) ?? null]));
  for (const id of ids) {
    const tz = byId.get(id);
    if (isValidTimeZone(tz)) return tz;
  }
  return null;
}
