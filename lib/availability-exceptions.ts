import { resolveBlockedRangesForDate, type BlockedRange } from "@/lib/booking-slots";

// Fetches a coach's saved exceptions (one-off blocks + recurring blocks)
// and resolves them into concrete blocked ranges for one specific date —
// shared by every day-detail page that generates bookable slots, so the
// fetch-then-resolve shape only lives in one place.
export async function getBlockedRangesForDate(
  supabase: any,
  coachId: string,
  date: Date
): Promise<BlockedRange[]> {
  const { data } = await supabase
    .from("coach_availability_exceptions")
    .select("kind, start_at, end_at, weekday, start_time, end_time")
    .eq("coach_id", coachId);

  return resolveBlockedRangesForDate(
    date,
    (data ?? []).map((e: any) => ({
      kind: e.kind,
      startAt: e.start_at,
      endAt: e.end_at,
      weekday: e.weekday,
      startTime: e.start_time,
      endTime: e.end_time,
    }))
  );
}
