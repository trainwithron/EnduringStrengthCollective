import { pageAll } from "@/lib/page-all";

// How many requests are waiting on a coach's answer (Ron, Nov 20, wave 3 C10): the same four kinds the Requests page lists as waiting. A session asked for or a move (not yet
// lapsed), a late cancel or move to charge or waive, a weekly-schedule change, and someone asking to train with the coach. Across every organization the coach belongs to (a
// coach answers all of them); only a count leaves this file, never who or what.

export const REQUESTS_DIGEST_KIND = "requests_digest";
// The coach's morning: the line goes out the first run at or after 8 AM in the coach's own time zone, and not after noon (a run that could not reach them by then waits for
// tomorrow).
export const DIGEST_FROM_HOUR = 8;
export const DIGEST_UNTIL_HOUR = 12;

export function requestsWaitingLine(count: number): { title: string; body: string } {
  return { title: "Requests waiting", body: count === 1 ? "1 request is waiting for your answer." : `${count} requests are waiting for your answer.` };
}

type Read = (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>;

/** Each coach's count, from rows of coach ids. `onlyCoach` narrows every read to one coach (the badge). Null when any read failed (no line rather than a wrong number). */
export async function countWaitingByCoach(db: any, now: Date = new Date(), onlyCoach?: string): Promise<Map<string, number> | null> {
  const nowIso = now.toISOString();
  const narrow = (q: any) => (onlyCoach ? q.eq("coach_id", onlyCoach) : q);
  const reads: Read[] = [
    (from, to) => narrow(db.from("booking_requests").select("id, coach_id").eq("status", "pending").gt("new_start_at", nowIso)).order("id").range(from, to),
    (from, to) => narrow(db.from("bookings").select("id, coach_id").eq("late_charge_state", "flagged")).order("id").range(from, to),
    (from, to) => narrow(db.from("schedule_requests").select("id, coach_id").in("status", ["pending", "applying"])).order("id").range(from, to),
    (from, to) => narrow(db.from("client_requests").select("id, coach_id").eq("status", "pending")).order("id").range(from, to),
  ];
  const results = await Promise.all(reads.map((r) => pageAll(r, { maxPages: 20 })));
  if (results.some((r) => r.failed || r.truncated)) return null;
  const counts = new Map<string, number>();
  for (const r of results) for (const row of r.rows as { coach_id: string | null }[]) if (row.coach_id) counts.set(row.coach_id, (counts.get(row.coach_id) ?? 0) + 1);
  return counts;
}

/** The coach's local hour is in the morning window. */
export function inDigestMorning(localHour: number): boolean {
  return localHour >= DIGEST_FROM_HOUR && localHour < DIGEST_UNTIL_HOUR;
}
