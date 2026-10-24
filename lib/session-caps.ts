// Session caps, Keep my sessions together and a lunch break (Ron, Oct 23: "I need to limit my weekly sessions at 25. I can't go over 100 sessions a month" and "it doesn't show wide
// open. It would recommend the most likely places that I would want to be booked at"). The database decides what a client may book (client_slot_reason, migration 0432); the screens
// ask it about the times they are about to offer (client_slot_reasons), so a client is only ever offered what will be accepted. Pure helpers here.

export type SlotReason = "week_full" | "month_full" | "lunch" | "not_offered" | null;

export interface BookingLimits {
  maxPerWeek: number | null;
  maxPerMonth: number | null;
  keepTogether: boolean;
  lunchStart: string | null; // "12:00:00"
  lunchEnd: string | null;
}

export const NO_LIMITS: BookingLimits = { maxPerWeek: null, maxPerMonth: null, keepTogether: false, lunchStart: null, lunchEnd: null };
export const MAX_CAP = 500;

/** From a coach_booking_policies row (the columns are missing before 0432: no limits). */
export function limitsFromRow(row: Record<string, unknown> | null | undefined): BookingLimits {
  if (!row) return NO_LIMITS;
  const n = (v: unknown) => (typeof v === "number" && v >= 1 && v <= MAX_CAP ? v : null);
  const t = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}/.test(v) ? v : null);
  return { maxPerWeek: n(row.max_sessions_per_week), maxPerMonth: n(row.max_sessions_per_month), keepTogether: row.keep_together === true, lunchStart: t(row.lunch_start), lunchEnd: t(row.lunch_end) };
}

/** Whether the screens need to ask the server which times to offer at all (nothing set = offer as before, no extra request). */
export const limitsActive = (l: BookingLimits): boolean => l.maxPerWeek != null || l.maxPerMonth != null || l.keepTogether || (l.lunchStart != null && l.lunchEnd != null);

/** The slots the server would accept, in order. A failed answer keeps every slot (the server still refuses anything it would not accept). */
export function keepOffered<T>(slots: T[], reasons: (string | null)[] | null): T[] {
  if (!reasons || reasons.length !== slots.length) return slots;
  return slots.filter((_, i) => reasons[i] == null);
}

/** What a client is told when nothing is offered because a cap is reached: "Fully booked this week" (or month); null otherwise. */
export function fullyBookedLine(reasons: (string | null)[] | null): string | null {
  if (!reasons || reasons.length === 0) return null;
  if (reasons.every((r) => r === "week_full" || r === "month_full")) return reasons.some((r) => r === "month_full") ? "Fully booked this month" : "Fully booked this week";
  return null;
}

/** The coach's "25 of 25 this week": amber at the cap, rust over it, plain under it. */
export function capLine(count: number, cap: number | null, period: "week" | "month"): { text: string; tone: "plain" | "amber" | "rust" } | null {
  if (cap == null) return null;
  return { text: `${count} of ${cap} this ${period}`, tone: count > cap ? "rust" : count === cap ? "amber" : "plain" };
}

export const capToneClass = (tone: "plain" | "amber" | "rust"): string => (tone === "rust" ? "text-rust" : tone === "amber" ? "text-amber" : "text-steel");

/** Ask the server about the times a client screen is about to offer. Null when it cannot answer (the screen then offers as before). */
export async function fetchSlotReasons(supabase: any, coachId: string, slots: { start: Date; end: Date }[], ignoreBookingId: string | null = null): Promise<(string | null)[] | null> {
  if (slots.length === 0) return [];
  try {
    const { data, error } = await supabase.rpc("client_slot_reasons", {
      p_coach_id: coachId,
      p_starts: slots.slice(0, 400).map((s) => s.start.toISOString()),
      p_ends: slots.slice(0, 400).map((s) => s.end.toISOString()),
      // a client moving a session: that session is not counted (the server does the same)
      ...(ignoreBookingId ? { p_ignore_booking_id: ignoreBookingId } : {}),
    });
    if (error || !Array.isArray(data)) return null;
    // beyond 400 the extra times are not offered (a day or a fortnight of times is far fewer)
    return [...(data as (string | null)[]), ...Array(Math.max(0, slots.length - 400)).fill("not_offered")];
  } catch {
    return null;
  }
}

/**
 * The coach's own cap lines for a week and a month (0432: counted exactly as the caps count, across every organization), or [] when no cap is set or a read failed. Server side.
 */
export async function loadCapLines(
  supabase: any,
  coachId: string,
  range: { weekFromIso: string; weekToIso: string; monthFromIso: string; monthToIso: string }
): Promise<{ text: string; tone: "plain" | "amber" | "rust" }[]> {
  try {
    const limitsRead = await supabase.from("coach_booking_policies").select("max_sessions_per_week, max_sessions_per_month").eq("coach_id", coachId).maybeSingle();
    if (limitsRead.error) return [];
    const limits = limitsFromRow(limitsRead.data);
    if (limits.maxPerWeek == null && limits.maxPerMonth == null) return [];
    const count = async (from: string, to: string) => {
      const { data, error } = await supabase.rpc("my_session_count", { p_from: from, p_to: to });
      return error || typeof data !== "number" ? null : data;
    };
    const [week, month] = await Promise.all([
      limits.maxPerWeek != null ? count(range.weekFromIso, range.weekToIso) : Promise.resolve(null),
      limits.maxPerMonth != null ? count(range.monthFromIso, range.monthToIso) : Promise.resolve(null),
    ]);
    return [week != null ? capLine(week, limits.maxPerWeek, "week") : null, month != null ? capLine(month, limits.maxPerMonth, "month") : null].filter(
      (x): x is { text: string; tone: "plain" | "amber" | "rust" } => x !== null
    );
  } catch {
    return [];
  }
}
