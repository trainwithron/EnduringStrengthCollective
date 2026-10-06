import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { SchedulingSpotterPanel } from "./scheduling-spotter-panel";
import { gatherSchedulingSpotterFlags } from "@/lib/calendar-spotter-phase2-gather";

function fakeDb(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        lte: () => chain,
        not: () => chain,
        order: () => chain,
        then: (resolve: any) => resolve({ data: tables[table] ?? [], error: null }),
      };
      return chain;
    },
  } as any;
}

// Monday and Saturday hours only (Wednesday is a day off with no window), and nothing booked for weeks.
const windows = [
  { weekday: 1, start_time: "06:00", end_time: "17:00" },
  { weekday: 6, start_time: "08:00", end_time: "12:00" },
];

describe("the gap question", () => {
  it("is one friendly line, never a list of weekdays, and never mentions a day with no hours", async () => {
    const flags = await gatherSchedulingSpotterFlags(fakeDb({ coach_availability_windows: windows }), { coachId: "c", organizationId: null });
    const gaps = flags.filter((f) => f.checkKind === "schedule_gaps");
    expect(gaps).toHaveLength(1);
    expect(gaps[0].headline).toBe("You have gaps in your schedule. Are you looking to fill them, or happy where you are?");
    expect(flags.some((f) => f.checkKind === "recurring_gap")).toBe(false);
    expect(JSON.stringify(flags)).not.toMatch(/Wednesday|Monday|Saturday/);
  });

  it("asks nothing for a coach who has no hours at all, or whose hours are being booked", async () => {
    expect(await gatherSchedulingSpotterFlags(fakeDb({}), { coachId: "c", organizationId: null })).toEqual([]);
  });

  it("remembers the answer: 'Happy where I am' keeps it quiet, 'Looking to fill them' moves on to what kind of clients", async () => {
    const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
    const happy = await gatherSchedulingSpotterFlags(
      fakeDb({ coach_availability_windows: windows, spotter_recommendation_feedback: [{ dismissal_key: "schedule_gaps::all", action: "denied", created_at: day(20), edit_detail: "happy" }] }),
      { coachId: "c", organizationId: null }
    );
    expect(happy.filter((f) => f.checkKind === "schedule_gaps")).toEqual([]);
    const fill = await gatherSchedulingSpotterFlags(
      fakeDb({ coach_availability_windows: windows, spotter_recommendation_feedback: [{ dismissal_key: "schedule_gaps::all", action: "confirmed", created_at: day(1), edit_detail: "fill" }] }),
      { coachId: "c", organizationId: null }
    );
    const follow = fill.find((f) => f.checkKind === "schedule_gaps");
    expect(follow?.stage).toBe("followup");
    expect(follow?.headline).toBe("What kind of clients are you hoping to add?");
  });
});

describe("the Scheduling Spot panel", () => {
  const flag = { checkKind: "schedule_gaps" as const, patternKey: "all", headline: "x", stage: "ask" as const };
  it("shows the question with its two answers, plus Not now and a way to edit hours", () => {
    const html = renderToStaticMarkup(createElement(SchedulingSpotterPanel, { flags: [flag], availabilityHref: "/groups/g/calendar?tab=availability" }));
    expect(html).toContain("You have gaps in your schedule. Are you looking to fill them, or happy where you are?");
    expect(html).toContain("Looking to fill them");
    expect(html).toContain("Happy where I am");
    expect(html).toContain("Not now");
    expect(html).toContain("Edit my hours");
    expect(html).not.toContain("Confirm");
  });
  it("the follow-up offers online, hybrid and in person", () => {
    const html = renderToStaticMarkup(createElement(SchedulingSpotterPanel, { flags: [{ ...flag, patternKey: "clients", stage: "followup" }], availabilityHref: "/x" }));
    expect(html).toContain("What kind of clients are you hoping to add?");
    expect(html).toContain("Online");
    expect(html).toContain("Hybrid");
    expect(html).toContain("In person");
  });
});
