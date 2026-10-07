import type { SupabaseClient } from "@supabase/supabase-js";
import { pageAll } from "./page-all";

// One way to say where a client's sessions stand, used everywhere a balance is shown (Ron, Oct 6, after a sold 12-pack read "0 sessions" once it was scheduled
// out and the coach had to scan the calendar both ways): "8 left · 4 booked · 4 to book · 2 to mark".
//   left     the unused balance (session_credits.balance), never shown below 0
//   booked   confirmed sessions with the coach in the future that have not been settled (they take a session when they happen, not when they are booked)
//   to book  what is left after the booked ones, so the coach sees how many still need a time
//   owed     only what has already been DELIVERED beyond the balance (a negative balance): coach only, never worded to a client. Sessions booked ahead beyond
//            what is left are NOT owed: a weekly schedule runs a year out and the client pays as each one comes up, so they read "booked ahead", neutrally.
//   to mark  past sessions still waiting for attended or no-show (a no-show is done, and is not counted)
// A client's own workouts cost nothing and are never counted. A cancelled session is not counted (only confirmed ones are), an expired balance is already zero,
// and a payment hold changes none of the numbers.

export interface CreditPicture {
  left: number;
  booked: number;
  toBook: number;
  owed: number;
  // Booked sessions beyond what is left (neutral: "booked ahead").
  bookedAhead: number;
  toMark: number;
  // From the ledger, when known: sessions bought and sessions done, for the click-through sentence.
  bought?: number | null;
  done?: number | null;
}

export function buildCreditPicture(input: { balance: number | null | undefined; booked: number; toMark: number; bought?: number | null; done?: number | null }): CreditPicture {
  const balance = input.balance ?? 0;
  const left = Math.max(0, balance);
  const booked = Math.max(0, input.booked);
  return {
    left,
    booked,
    toBook: Math.max(0, left - booked),
    owed: Math.max(0, -balance),
    bookedAhead: Math.max(0, booked - left),
    toMark: Math.max(0, input.toMark),
    bought: input.bought ?? null,
    done: input.done ?? null,
  };
}

// The coach's line. With nothing booked or to mark it is just "8 left" (the rest would repeat it).
export function coachCreditPictureLine(p: CreditPicture): string {
  const parts = [`${p.left} left`];
  if (p.booked > 0) parts.push(p.bookedAhead > 0 ? `${p.booked} booked ahead` : `${p.booked} booked`);
  if (p.owed > 0) parts.push(`owed ${p.owed}`);
  else if (p.booked > 0 && p.toBook > 0) parts.push(`${p.toBook} to book`);
  if (p.toMark > 0) parts.push(`${p.toMark} to mark`);
  return parts.join(" · ");
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
  end_at?: string | null;
  attended_at?: string | null;
  no_show?: boolean | null;
  credit_state?: string | null;
}

export interface BookingCounts {
  booked: number;
  toMark: number;
  // Future sessions the client already paid for when booking (self-booked): they are not "booked" in the sense above, and are not "completed" yet.
  prepaidAhead: number;
}

// Counts per `${athleteId}:${groupId}` from confirmed sessions: future unsettled ones are booked, ones that have ended and are still unattended and unsettled are
// waiting to be marked (a no-show is done), future prepaid ones are counted apart. A session counts as past once it has ended.
export function countBookings(rows: BookingCountRow[], now: Date): Map<string, BookingCounts> {
  const out = new Map<string, BookingCounts>();
  for (const r of rows) {
    const key = `${r.athlete_id}:${r.group_id}`;
    const entry = out.get(key) ?? { booked: 0, toMark: 0, prepaidAhead: 0 };
    const state = r.credit_state ?? "unsettled";
    const startMs = new Date(r.start_at).getTime();
    const endMs = r.end_at ? new Date(r.end_at).getTime() : startMs;
    if (endMs >= now.getTime()) {
      if (state === "unsettled") entry.booked += 1;
      else if (state === "prepaid") entry.prepaidAhead += 1;
    } else if (state === "unsettled" && !r.attended_at && !r.no_show) {
      entry.toMark += 1;
    }
    out.set(key, entry);
  }
  return out;
}

// Reads every confirmed, still-open session (a page at a time, past the 1000-row cap, in a stable order) for a coach's clients or for one client's own sessions.
// Fails soft: no counts. If the pages run out (25,000 rows) the counts are reported as of what was read.
// `athleteIds` narrows it to one screenful of clients (at most 100 at a time, so the request stays short).
export async function fetchBookingCounts(supabase: SupabaseClient, filter: { coachId?: string; athleteId?: string; athleteIds?: string[]; groupId?: string }, now: Date = new Date()): Promise<Map<string, BookingCounts>> {
  const { rows, failed, truncated } = await pageAll((from, to) => {
    let q = supabase
      .from("bookings")
      .select("id, athlete_id, group_id, start_at, end_at, attended_at, no_show, credit_state")
      .eq("status", "confirmed")
      .in("credit_state", ["unsettled", "prepaid"])
      // Only what can still be counted: sessions that have not ended, and ended ones still waiting to be marked (so old prepaid and no-show rows are never pulled).
      .or(`end_at.gte.${now.toISOString()},and(credit_state.eq.unsettled,attended_at.is.null,no_show.eq.false)`);
    if (filter.coachId) q = q.eq("coach_id", filter.coachId);
    if (filter.athleteId) q = q.eq("athlete_id", filter.athleteId);
    if (filter.athleteIds) q = q.in("athlete_id", filter.athleteIds.slice(0, 100));
    if (filter.groupId) q = q.eq("group_id", filter.groupId);
    return q.order("id", { ascending: true }).range(from, to);
  });
  // Partial counts would quietly read as complete ones, so running out of pages counts as a failure.
  if (failed || truncated) return new Map();
  return countBookings(rows as BookingCountRow[], now);
}
