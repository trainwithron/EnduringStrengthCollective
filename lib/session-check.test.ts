import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }), usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { isDateKey, planBookingMove, startOnDateKeepingTime, weekKeysMondayFirst } from "@/lib/booking-move";
import { clientMayBePushedAt, completedSessionPush } from "@/lib/completed-session-push";
import { SessionCheckCards } from "@/components/coach/session-check-cards";
import { BookingDateControl } from "@/components/coach/booking-date-control";
import { loadSessionsToCheck } from "@/components/coach/session-check-section";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const LA = "America/Los_Angeles";

// Ron's week: Jackson canceled Monday Oct 12, so that session is moved to Thursday Oct 15 (same booking, same time of day, still waiting to be marked).
describe("moving one booking to another day, keeping its time", () => {
  it("the seven days of the session's week, Monday first", () => {
    expect(weekKeysMondayFirst("2026-10-12")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(weekKeysMondayFirst("2026-10-15")).toEqual(weekKeysMondayFirst("2026-10-12"));
    expect(weekKeysMondayFirst("2026-10-18")[0]).toBe("2026-10-12"); // a Sunday belongs to the week before it
    expect(weekKeysMondayFirst("2026-10-18")[6]).toBe("2026-10-18");
  });
  it("Mon Oct 12 at 10:00 becomes Thu Oct 15 at 10:00 on the coach's clock (and keeps its length)", () => {
    const start = "2026-10-12T17:00:00.000Z"; // 10:00 PDT
    expect(startOnDateKeepingTime(start, "2026-10-15", LA)).toBe("2026-10-15T17:00:00.000Z");
    const plan = planBookingMove({ booking: { startAt: start, endAt: "2026-10-12T17:55:00.000Z", status: "confirmed", attendedAt: null, creditState: "unsettled" }, newDateKey: "2026-10-15", timezone: LA, now: new Date("2026-10-19T12:00:00Z") });
    expect(plan).toEqual({ ok: true, startIso: "2026-10-15T17:00:00.000Z", endIso: "2026-10-15T17:55:00.000Z" });
  });
  it("keeps the wall-clock time across the clocks changing (Nov 1)", () => {
    expect(startOnDateKeepingTime("2026-10-26T16:00:00.000Z", "2026-11-02", LA)).toBe("2026-11-02T17:00:00.000Z"); // 9:00 PDT -> 9:00 PST
  });
  it("refuses what it must: a session already marked, one not on the calendar, a date that is not a date, a date years away", () => {
    const base = { startAt: "2026-10-12T17:00:00.000Z", endAt: "2026-10-12T17:55:00.000Z", status: "confirmed", attendedAt: null as string | null, creditState: "unsettled" };
    const now = new Date("2026-10-19T12:00:00Z");
    expect(planBookingMove({ booking: { ...base, attendedAt: "2026-10-12T19:00:00Z" }, newDateKey: "2026-10-15", timezone: LA, now }).ok).toBe(false);
    expect(planBookingMove({ booking: { ...base, creditState: "settled" }, newDateKey: "2026-10-15", timezone: LA, now }).ok).toBe(false);
    expect(planBookingMove({ booking: { ...base, status: "cancelled" }, newDateKey: "2026-10-15", timezone: LA, now }).ok).toBe(false);
    expect(planBookingMove({ booking: base, newDateKey: "2026-13-45", timezone: LA, now }).ok).toBe(false);
    expect(planBookingMove({ booking: base, newDateKey: "2062-01-01", timezone: LA, now }).ok).toBe(false);
    expect(isDateKey("2026-02-30")).toBe(false);
  });
  it("the route keeps it ONE booking: it updates the same row (no insert, no cancel, no credit change), allows the past, and keeps a weekly slot from being booked again", () => {
    const route = read("app/api/bookings/move/route.ts");
    expect(route).toContain('db.from("bookings").update(patch).eq("id", b.id).eq("status", "confirmed").is("attended_at", null)');
    expect(route).not.toMatch(/\.insert\(|cancel_booking|session_credits|patch\.credit_state/);
    expect(route).toContain("skippedStarts: [...series.skippedStarts, old]");
    expect(route).toContain("authorizeCoachCall(");
    expect(route).toContain("That time is taken by another session.");
  });
});

describe("the date control", () => {
  it("shows an editable date and the seven days of that week, with the session's day marked", () => {
    const html = renderToStaticMarkup(createElement(BookingDateControl, { bookingId: "b1", startIso: "2026-10-12T17:00:00.000Z", timezone: LA, onMoved: () => {} }));
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-10-12"');
    expect(html.match(/aria-pressed/g)?.length).toBe(7);
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    for (const letter of ["M", "T", "W", "F", "S"]) expect(html).toContain(`<span>${letter}</span>`);
    expect(html).toContain("Monday, Oct 12");
  });
  it("is reached by tapping the date in the Waiting to be marked list, and the list is read again after a move", () => {
    const panel = read("components/coach/desktop/client-schedule-panel.tsx");
    expect(panel).toContain("Change the day");
    expect(panel).toContain("<BookingDateControl");
    expect(panel).toContain("load().catch(() => {});");
  });
});

describe("Did this session happen?", () => {
  const sessions = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => ({ bookingId: `b${i}`, athleteId: `a${i}`, groupId: "g", name: ["Hewan B.", "Cindie D.", "Karina R.", "Oliver B.", "Sawyer S."][i], startIso: `2026-10-${12 + i}T17:00:00.000Z` }));
  it("one card per session, oldest first, three shown with 'N more', each with Yes / No-show / Reschedule", () => {
    const html = renderToStaticMarkup(createElement(SessionCheckCards, { sessions, timezone: LA }));
    expect(html.match(/Did <span/g)?.length).toBe(3);
    expect(html).toContain("Hewan B.");
    expect(html).toContain("happen?");
    expect(html.indexOf("Hewan B.")).toBeLessThan(html.indexOf("Cindie D."));
    expect(html).not.toContain("Oliver B.");
    expect(html).toContain("2 more");
    expect(html.match(/>Yes</g)?.length).toBe(3);
    expect(html.match(/>No-show</g)?.length).toBe(3);
    expect(html.match(/>Reschedule</g)?.length).toBe(3);
  });
  it("nothing to show means nothing is drawn", () => {
    expect(renderToStaticMarkup(createElement(SessionCheckCards, { sessions: [], timezone: LA }))).toBe("");
  });
  it("Yes marks attended (as everywhere), No-show asks Charge or Waive (resolve_no_show; the old cancel is gone), Reschedule opens the date control; nothing is automatic and nothing is pushed to the coach", () => {
    const src = read("components/coach/session-check-cards.tsx");
    expect(src).toContain('rpc("mark_booking_attended"');
    expect(src).toContain('rpc("resolve_no_show", { p_booking_id: s.bookingId, p_charge: charge })');
    expect(src).toContain("onClick={() => noShow(s, true)}");
    expect(src).toContain("onClick={() => noShow(s, false)}");
    expect(src).toContain("Charge 1 session");
    expect(src).not.toContain("cancel_booking_and_refund_credit");
    expect(src).toContain("<BookingDateControl");
    expect(src).not.toMatch(/sendPush|push\/send/);
  });
  it("is at the top of the coach Home and Calendar, on a computer and on a phone", () => {
    expect(read("app/(coach)/dashboard/page.tsx").indexOf("<SessionCheckSection")).toBeLessThan(read("app/(coach)/dashboard/page.tsx").indexOf("<YourDayPanel"));
    const cal = read("components/coach/calendar-page-body.tsx");
    expect(cal.match(/<SessionCheckSection/g)?.length).toBe(1);
    // on a phone: the coach's own Calendar (the phone schedule) and the top of Spotlight
    expect(read("components/coach/mobile/coach-phone-schedule.tsx")).toContain("<SessionCheckSection coachId={userId} groupIds={orgGroupIds} />");
    expect(read("components/coach/mobile/spot-needs-top.tsx")).toContain("<SessionCheckCards sessions={needs.sessionsToCheck} timezone={needs.timezone} />");
  });
  it("loads the same sessions the client panel calls 'waiting to be marked', oldest first, one organization's groups only, short names", async () => {
    const rows = [
      { id: "b1", athlete_id: "a1", group_id: "g1", start_at: "2026-10-12T17:00:00Z" },
      { id: "b2", athlete_id: "a2", group_id: "g2", start_at: "2026-10-13T17:00:00Z" },
    ];
    const calls: string[] = [];
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => (calls.push(`${c}=${String(v)}`), chain),
      is: (c: string) => (calls.push(`${c} is null`), chain),
      lt: (c: string) => (calls.push(`${c}<now`), chain),
      order: () => chain,
      range: async () => ({ data: rows, error: null }),
      in: (col: string) => (col === "group_id" ? (calls.push("group_id in ids"), chain) : Promise.resolve({ data: [{ id: "a1", full_name: "Hewan Belete" }, { id: "a2", full_name: "Cindie Downing" }], error: null })),
    };
    const supabase = { from: () => chain };
    const out = await loadSessionsToCheck(supabase, "coach", ["g1", "g2"]);
    expect(out.map((s) => [s.bookingId, s.name])).toEqual([["b1", "Hewan B."], ["b2", "Cindie D."]]);
    expect(calls).toEqual(expect.arrayContaining(["group_id in ids", "coach_id=coach", "status=confirmed", "credit_state=unsettled", "attended_at is null", "no_show=false", "end_at<now"]));
  });
});

describe("the client's push after the coach marks a session", () => {
  it("says what Ron asked, plainly, with the number left", () => {
    expect(completedSessionPush("Ron Arnold", 9)).toEqual({ title: "Good job today", body: "Good job completing your session with Ron today. You have 9 sessions left." });
    expect(completedSessionPush("Ron Arnold", 1).body).toContain("You have 1 session left.");
    expect(completedSessionPush("Ron Arnold", 0).body).toContain("That was your last session. Ask Ron about renewing.");
    expect(completedSessionPush("Ron Arnold", -2).body).toContain("Ask Ron about renewing.");
    expect(completedSessionPush(null, null).body).toBe("Good job completing your session with your coach today.");
  });
  it("only between 7:00 and 20:59 in the client's own time", () => {
    for (const h of [0, 5, 6, 21, 23]) expect(clientMayBePushedAt(h), String(h)).toBe(false);
    for (const h of [7, 12, 20]) expect(clientMayBePushedAt(h), String(h)).toBe(true);
  });
  it("only the coach of the session's group can ask, only for a session really marked attended, never for the coach's own and the client never marks anything", () => {
    const route = read("app/api/bookings/completed-notice/route.ts");
    expect(route).toContain('(seat as { role?: string } | null)?.role !== "coach"');
    expect(route).toContain("!b.attended_at");
    expect(route).toContain("b.athlete_id === user.id");
    expect(read("components/coach/mark-attended-control.tsx")).toContain("/api/bookings/completed-notice");
  });
});
