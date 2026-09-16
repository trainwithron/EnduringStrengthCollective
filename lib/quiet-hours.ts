// Pure boundary math for a coach's configured "don't text during these
// hours" window. Takes a Date whose UTC-read hour/minute already equal
// the coach's own local wall-clock time — the caller is responsible for
// that conversion (lib/timezone.ts's nowInZone already returns exactly
// this shape), so this function itself never touches IANA zone names.
export function isWithinQuietHours(
  nowInCoachZone: Date,
  quietHoursStart: string | null,
  quietHoursEnd: string | null
): boolean {
  if (!quietHoursStart || !quietHoursEnd) return false;

  const [startHour, startMinute] = quietHoursStart.split(":").map(Number);
  const [endHour, endMinute] = quietHoursEnd.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  if (startMinutes === endMinutes) return false; // zero-width window = disabled

  const nowMinutes = nowInCoachZone.getUTCHours() * 60 + nowInCoachZone.getUTCMinutes();

  if (startMinutes < endMinutes) {
    // Same-day window, e.g. 12:00 -> 14:00.
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Overnight window, e.g. 21:00 -> 07:00.
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}
