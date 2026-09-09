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
