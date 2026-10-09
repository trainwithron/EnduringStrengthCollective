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

// "YYYY-MM-DD" for the device's OWN calendar day (browser code only). A
// logged date written with new Date().toISOString().slice(0, 10) is UTC's
// date, which flips to "tomorrow" for a US athlete after ~7-8pm — so their
// evening weigh-in or photo landed on the wrong day.
export function localDateKey(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export const DEFAULT_COACH_TIMEZONE = "America/New_York";

// "YYYY-MM-DD" + "HH:MM" (optionally "HH:MM:SS") in `timeZone` -> the real
// UTC instant. Handles DST correctly for the given date, since the offset
// is derived by asking Intl what that exact instant reads as in both zones,
// not from a fixed/hardcoded UTC offset.
// How far ahead of UTC `timeZone` is at the instant `ms`, in milliseconds (negative for the Americas). Read from the zone's own wall clock
// at that instant, so it is right on both sides of a clock change and does not depend on the machine's own time zone.
function offsetAtMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);

  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  // Two passes: the offset is looked up at a first guess, then again at the corrected instant, because on a day the clocks change the
  // guess can land on the other side of the change (one hour off).
  const first = asIfUtc - offsetAtMs(asIfUtc, timeZone);
  return new Date(asIfUtc - offsetAtMs(first, timeZone));
}

// A datetime-local box's value ("YYYY-MM-DDTHH:MM") read as a wall clock in `timeZone`, as the real UTC instant. A box read with new Date(value) takes the
// BROWSER's zone instead, so a coach typing 9:00 in Alabama for a block in their Pacific business hours would save 9:00 Central.
export function zonedLocalInputToUtc(value: string, timeZone: string): Date {
  const [datePart, timePart] = value.split("T");
  return zonedTimeToUtc(datePart, timePart ?? "00:00", timeZone);
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

// The real start and end instants of the calendar day it is right now in `timeZone`, plus that day's key. The end is the next local
// midnight, so a day with a daylight-saving change is 23 or 25 hours long rather than a fixed 24. Use these for "today" queries instead of
// the UTC date, which for a US coach is already tomorrow in the evening.
export function localDayBounds(timeZone: string, now: Date = new Date()): { dateKey: string; startIso: string; endIso: string } {
  const dateKey = dateKeyInZone(timeZone, now);
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return {
    dateKey,
    startIso: zonedTimeToUtc(dateKey, "00:00", timeZone).toISOString(),
    endIso: zonedTimeToUtc(next, "00:00", timeZone).toISOString(),
  };
}

// The month it is right now in `timeZone` ("YYYY-MM") and the real instant that month began there. A month start built from the server's own clock
// (UTC) is hours off for a US coach, so the last evening of a month counts as the next month.
export function monthBoundsInZone(timeZone: string, now: Date = new Date()): { monthKey: string; startIso: string } {
  const monthKey = dateKeyInZone(timeZone, now).slice(0, 7);
  return { monthKey, startIso: zonedTimeToUtc(`${monthKey}-01`, "00:00", timeZone).toISOString() };
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
