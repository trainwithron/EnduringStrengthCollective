import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("a client's own booking and move must stay inside the coach's hours (server check, migration 0312)", () => {
  const sql = read("supabase/migrations/0312_booking_hours_server_check.sql");
  it("book_session and reschedule_booking both call coach_time_is_open, and only for a client (never a coach or the server)", () => {
    const book = sql.slice(sql.indexOf("function public.book_session("), sql.indexOf("function public.reschedule_booking("));
    const move = sql.slice(sql.indexOf("function public.reschedule_booking("));
    expect(book).toContain("v_is_self and not coalesce(public.is_group_coach(p_group_id), false) and not public.coach_time_is_open(p_coach_id, p_start_at, p_end_at)");
    expect(move).toContain("not coalesce(public.is_group_coach(v_group_id), false) and not public.coach_time_is_open(v_coach_id, p_new_start_at, p_new_end_at)");
  });
  it("keeps the rights as they are and refuses to run if they are not", () => {
    expect(sql).toContain("has_function_privilege('anon', 'public.book_session");
    expect(sql).not.toMatch(/grant execute/i);
    expect(sql).not.toMatch(/revoke/i);
  });
  it("the screens turn the refusal into a plain sentence", () => {
    expect(read("lib/booking-refusal-copy.ts")).toContain("That time is outside your coach's hours.");
    expect(read("components/athlete/book-slot-button.tsx")).toContain("bookingRefusalMessage(");
    expect(read("components/athlete/reschedule-slot-button.tsx")).toContain("bookingRefusalMessage(");
  });
});
