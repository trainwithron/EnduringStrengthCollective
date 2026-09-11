// Booking/scheduling had no timezone handling anywhere: coach_availability
// windows' start_time/end_time are meant as the coach's own local wall-clock
// hours, but every call site built candidate slots with plain
// `date.setHours(...)`, which is always interpreted in whatever machine is
// running the code — the browser's local zone for a client component, but
// UTC for every server-rendered page and API route (Vercel's server clock
// is always UTC). A US-based coach's "9:00 AM" was silently read as
// 9:00 AM UTC on every server-rendered booking page — hours off from what
// they actually configured, for anyone not literally in the UTC zone.
//
// No date library is added for this — vanilla Intl is enough for the one
// operation actually needed (convert a wall-clock date+time in a named IANA
// zone into the real UTC instant it represents), and it stays consistent
// with this app's existing zero-date-dependency approach.

export const DEFAULT_COACH_TIMEZONE = "America/New_York";

// "YYYY-MM-DD" + "HH:MM" (optionally "HH:MM:SS") in `timeZone` -> the real
// UTC instant. Handles DST correctly for the given date, since the offset
// is derived by asking Intl what that exact instant reads as in both zones,
// not from a fixed/hardcoded UTC offset.
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);

  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const probe = new Date(asIfUtc);

  // How that same instant reads as a wall clock in each zone — the
  // difference between them is the zone's real UTC offset at this
  // specific date (so DST transitions resolve correctly).
  const zoned = new Date(probe.toLocaleString("en-US", { timeZone }));
  const utc = new Date(probe.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = utc.getTime() - zoned.getTime();

  return new Date(asIfUtc + offsetMs);
}

// The reverse direction: "what does a wall clock read right now, in
// `timeZone`" — needed anywhere server code asks "is it today yet" for a
// specific coach/program, since every server-rendered page and API route
// runs on Vercel's clock (always UTC), not the coach's own zone. Returns a
// Date whose UTC-read calendar fields (getUTCFullYear/getUTCMonth/etc, and
// critically the plain getFullYear/getDate/setHours family too, since the
// server's own local zone IS UTC) already equal the target zone's real
// wall-clock reading — so existing date-only comparisons elsewhere (which
// read a Date's fields via the server's local/UTC interpretation) get the
// zone-correct answer without needing to change their own logic.
export function nowInZone(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Midnight formats as hour 24 in some ICU builds under hour12:false —
  // normalize back to 0 so Date.UTC doesn't roll into the next day.
  const hour = get("hour") % 24;
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second")));
}

// "YYYY-MM-DD" for right now, as seen in `timeZone` — the zone-correct
// version of `new Date().toISOString().slice(0, 10)`, which is always
// UTC's date regardless of whose schedule it's actually being compared
// against.
export function dateKeyInZone(timeZone: string, now: Date = new Date()): string {
  return nowInZone(timeZone, now).toISOString().slice(0, 10);
}

// One group's coach's stored zone (profiles.timezone), for "is it today
// yet" checks against that group's own program schedule — the same
// convention already used for booking/availability, extended to content
// visibility. Falls back to DEFAULT_COACH_TIMEZONE when unset, same as
// every existing booking-side call site.
export async function getGroupCoachTimezone(
  supabase: { from: (table: string) => any },
  groupId: string
): Promise<string> {
  const { data } = await supabase
    .from("group_memberships")
    .select("profiles ( timezone )")
    .eq("group_id", groupId)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();
  return (data as any)?.profiles?.timezone ?? DEFAULT_COACH_TIMEZONE;
}
