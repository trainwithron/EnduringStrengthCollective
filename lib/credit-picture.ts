import type { SupabaseClient } from "@supabase/supabase-js";

// One way to say where a client's sessions stand, used everywhere a balance is shown (Ron, Oct 6, after a sold 12-pack read "0 sessions" once it was scheduled
// out and the coach had to scan the calendar both ways): "8 left · 4 booked · 4 to book · 2 to mark".
//   left     the unused balance (session_credits.balance), never shown below 0
//   booked   confirmed sessions with the coach in the future that have not been settled (they take a session when they happen, not when they are booked)
//   to book  what is left after the booked ones, so the coach sees how many still need a time
//   owed     booked beyond what is left, plus anything already owed (a negative balance): coach only, never worded to a client
//   to mark  past sessions still waiting for attended or no-show
// A client's own workouts cost nothing and are never counted. A cancelled session is not counted (only confirmed ones are), an expired balance is already zero,
// and a payment hold changes none of the numbers.

export interface CreditPicture {
  left: number;
  booked: number;
  toBook: number;
  owed: number;
  toMark: number;
  // From the ledger, when known: sessions bought and sessions done, for the tap-or-hover detail "(12 bought, 4 done)".
  bought?: number | null;
  done?: number | null;
}

export function buildCreditPicture(input: { balance: number | null | undefined; booked: number; toMark: number; bought?: number | null; done?: number | null }): CreditPicture {
  const balance = input.balance ?? 0;
  const left = Math.max(0, balance);
  const alreadyOwed = Math.max(0, -balance);
  const booked = Math.max(0, input.booked);
  return {
    left,
    booked,
    toBook: Math.max(0, left - booked),
    owed: alreadyOwed + Math.max(0, booked - left),
    toMark: Math.max(0, input.toMark),
    bought: input.bought ?? null,
    done: input.done ?? null,
  };
}

// The coach's line. With nothing booked or to mark it is just "8 left" (the rest would repeat it).
export function coachCreditPictureLine(p: CreditPicture): string {
  const parts = [`${p.left} left`];
  if (p.booked > 0) parts.push(`${p.booked} booked`);
  if (p.owed > 0) parts.push(`owed ${p.owed}`);
  else if (p.booked > 0 && p.toBook > 0) parts.push(`${p.toBook} to book`);
  if (p.toMark > 0) parts.push(`${p.toMark} to mark`);
  return parts.join(" · ");
}

// The tap-or-hover detail, when the ledger numbers are known.
export function creditPictureDetail(p: CreditPicture): string | null {
  if (p.bought == null || p.done == null) return null;
  return `(${p.bought} bought, ${p.done} done)`;
}

// The client's line: plain, never "owed" or "to mark".
export function clientCreditPictureLine(p: CreditPicture, noSessionsLine: string): string {
  if (p.left === 0 && p.booked === 0) return noSessionsLine;
  return p.booked > 0 ? `${p.left} left · ${p.booked} booked` : `${p.left} left`;
}

export interface BookingCountRow {
  athlete_id: string;
  group_id: string;
  start_at: string;
  attended_at?: string | null;
}

// Counts per `${athleteId}:${groupId}` from confirmed, unsettled sessions: future ones are booked, past unattended ones are waiting to be marked.
export function countBookings(rows: BookingCountRow[], now: Date): Map<string, { booked: number; toMark: number }> {
  const out = new Map<string, { booked: number; toMark: number }>();
  for (const r of rows) {
    const key = `${r.athlete_id}:${r.group_id}`;
    const entry = out.get(key) ?? { booked: 0, toMark: 0 };
    if (new Date(r.start_at).getTime() >= now.getTime()) entry.booked += 1;
    else if (!r.attended_at) entry.toMark += 1;
    out.set(key, entry);
  }
  return out;
}

// One query for a coach's clients (or one client's own sessions): confirmed sessions that have not been settled or waived. Fails soft: no counts.
export async function fetchBookingCounts(supabase: SupabaseClient, filter: { coachId?: string; athleteId?: string; groupId?: string }, now: Date = new Date()): Promise<Map<string, { booked: number; toMark: number }>> {
  let q = supabase.from("bookings").select("athlete_id, group_id, start_at, attended_at").eq("status", "confirmed").eq("credit_state", "unsettled");
  if (filter.coachId) q = q.eq("coach_id", filter.coachId);
  if (filter.athleteId) q = q.eq("athlete_id", filter.athleteId);
  if (filter.groupId) q = q.eq("group_id", filter.groupId);
  const { data, error } = await q.limit(5000);
  if (error) return new Map();
  return countBookings((data ?? []) as BookingCountRow[], now);
}
