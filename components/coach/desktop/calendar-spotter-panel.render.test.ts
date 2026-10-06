import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ rpc: async () => ({ error: null }) }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { CalendarSpotterPanel } from "./calendar-spotter-panel";
import { gatherCalendarSpotterFindings } from "@/lib/calendar-spotter-gather";
import { attendanceDismissalKey } from "@/lib/calendar-spotter-dismiss";

const NOW = Date.now();
const iso = (days: number) => new Date(NOW + days * 86400000).toISOString();

function fakeDb(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        like: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: any) => {
          if (tables[table] === undefined && table === "client_inactive") return resolve({ data: null, error: { message: "no table" } });
          resolve({ data: tables[table] ?? [], error: null });
        },
      };
      return chain;
    },
  } as any;
}

// Alice last attended 20 days ago and has a session booked in 5 days.
const bookings = [
  { id: "b1", athlete_id: "alice", start_at: iso(-20), status: "confirmed", no_show: false, late_cancel: false, recurring_series_id: null, profiles: { full_name: "Alice Athlete" } },
  { id: "b2", athlete_id: "alice", start_at: iso(5), status: "confirmed", no_show: false, late_cancel: false, recurring_series_id: "s1", profiles: { full_name: "Alice Athlete" } },
];

describe("a Calendar Spot row can be put away, and a session coming up can be cancelled from it", () => {
  it("the attendance gap names the client, offers a note, Not now and Don't flag, and the next session with the existing cancel", async () => {
    const findings = await gatherCalendarSpotterFindings(fakeDb({ bookings }), { groupId: "g1", coachId: "coach" });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ athleteId: "alice", kind: "gap", nextBooking: { id: "b2", recurringSeriesId: "s1" } });
    const html = renderToStaticMarkup(createElement(CalendarSpotterPanel, { findings, groupId: "g1", timezone: "America/Los_Angeles" }));
    expect(html).toContain("Alice Athlete hasn&#x27;t attended a session in 20 days.");
    expect(html).toContain("Send a note");
    expect(html).toContain("Not now");
    expect(html).toContain("Don&#x27;t flag Alice");
    expect(html).toContain("Next session");
    expect(html).toContain("Cancel");
  });

  it("a coach's own 'Not now' keeps the row quiet, a later one does not, and the nightly jobs (no coach) still see it", async () => {
    const key = attendanceDismissalKey("alice", "gap");
    const recent = [{ dismissal_key: key, created_at: iso(-2), edit_detail: null }];
    const old = [{ dismissal_key: key, created_at: iso(-30), edit_detail: null }];
    expect(await gatherCalendarSpotterFindings(fakeDb({ bookings, spotter_recommendation_feedback: recent }), { groupId: "g1", coachId: "coach" })).toEqual([]);
    expect(await gatherCalendarSpotterFindings(fakeDb({ bookings, spotter_recommendation_feedback: old }), { groupId: "g1", coachId: "coach" })).toHaveLength(1);
    expect(await gatherCalendarSpotterFindings(fakeDb({ bookings, spotter_recommendation_feedback: recent }), { groupId: "g1" })).toHaveLength(1);
  });

  it("a client the coach set aside as inactive is not flagged", async () => {
    const r = await gatherCalendarSpotterFindings(fakeDb({ bookings, client_inactive: [{ group_id: "g1", athlete_id: "alice" }] }), { groupId: "g1", coachId: "coach" });
    expect(r).toEqual([]);
  });

  it("a client with no session coming up shows no Cancel", async () => {
    const findings = await gatherCalendarSpotterFindings(fakeDb({ bookings: [bookings[0]] }), { groupId: "g1", coachId: "coach" });
    const html = renderToStaticMarkup(createElement(CalendarSpotterPanel, { findings, groupId: "g1" }));
    expect(html).not.toContain("Next session");
    expect(html).toContain("Not now");
  });
});
