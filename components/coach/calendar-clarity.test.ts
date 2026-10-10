import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the coach's Calendar is a coach-level page", () => {
  const route = read("app/(coach)/calendar/page.tsx");
  const old = read("app/(coach)/groups/[groupId]/calendar/page.tsx");
  const body = read("components/coach/calendar-page-body.tsx");
  const shell = read("components/coach/coach-desktop-shell.tsx");

  it("/calendar shows the calendar with the organization-only bar (coachLevel), no group in the address", () => {
    expect(route).toContain("<CoachCalendarPageBody coachLevel");
    expect(body).toContain("active=\"calendar\" coachLevel={coachLevel}");
    expect(body).toContain('const basePath = coachLevel ? "/calendar" : `/groups/${params.groupId}/calendar`;');
  });

  it("the rail's Calendar goes to /calendar, not to one group", () => {
    expect(shell).toContain('href: "/calendar", icon: CalendarDays');
  });

  it("old /groups/<id>/calendar links still work: a coach on a computer is sent to /calendar with their query kept; clients and phones keep the group page", () => {
    expect(old).toContain("redirect(`/calendar${qs.size > 0");
    expect(old).toContain('membership?.role === "coach"');
    expect(old).toContain("!(await prefersAthleteStyleView())");
    expect(old).toContain("isActingAsOther");
    expect(old).toContain("<CoachCalendarPageBody");
  });

  it("a coach on a phone is sent to the group calendar, and a non-coach to their own calendar", () => {
    expect(route).toContain("redirect(`/groups/${anchor.id}/calendar");
    expect(route).toContain("redirect(membership ? `/groups/${membership.group_id}/calendar` : \"/\")");
  });
});
