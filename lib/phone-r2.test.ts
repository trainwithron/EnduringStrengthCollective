import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mySpaceTarget, mySpaceHref } from "./my-space-target";
import { phoneCoachRedirect, PHONE_CALENDAR, PHONE_SPOTLIGHT } from "./phone-coach-routes";
import { COACH_HOME_HREF, COACH_PHONE_LANDING } from "./start-group";

// Release 2 (Ron, Oct 19-20): "Is it immediately open to my account? And then the only difference will be that I have the spot button up top." Team-only coaches keep their team Home;
// the calendar is one organization at a time (both Ron's decisions).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const S = "11111111-1111-4111-8111-111111111111";

describe("/my-space opens a tab of the coach's own app", () => {
  it("only Home, Calendar, Feed, Nutrition or Settings; the month and Spotlight pass through, nothing else", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(mySpaceTarget(S, q("view=client"))).toBe(`/groups/${S}`);
    expect(mySpaceTarget(S, q("view=client&to=calendar&month=2026-11"))).toBe(`/groups/${S}/calendar?month=2026-11`);
    expect(mySpaceTarget(S, q("view=client&to=settings&spot=1"))).toBe(`/groups/${S}/settings?spot=1`);
    expect(mySpaceTarget(S, q("view=client&to=../admin"))).toBe(`/groups/${S}`);
    expect(mySpaceTarget(S, q("view=client&to=calendar&month=x&next=/evil"))).toBe(`/groups/${S}/calendar`);
    expect(mySpaceHref("nutrition")).toBe("/my-space?view=client&to=nutrition");
    expect(mySpaceHref(null, { spot: true })).toBe("/my-space?view=client&spot=1");
  });
});

describe("Sawyer: Home from a coach tool is never a client's one-on-one space", () => {
  it("every Coach mode bar and the finished workout go to the coaching Home (on a phone: their own app or team Home)", () => {
    expect(COACH_HOME_HREF).toBe("/dashboard");
    for (const f of ["app/(coach)/groups/[groupId]/athletes/[athleteId]/log/page.tsx", "app/(coach)/groups/[groupId]/athletes/[athleteId]/log/[workoutId]/page.tsx"]) {
      const s = read(f);
      expect(s, f).toContain("homeHref={COACH_HOME_HREF}");
      expect(s, f).not.toContain("homeHref={`/groups/${params.groupId}`}");
    }
    expect(read("app/sessions/[sessionId]/page.tsx")).toContain("const coachHomeHref = COACH_HOME_HREF;");
    expect(read("app/(coach)/dashboard/page.tsx")).toContain("redirect(COACH_PHONE_ENTRY_KEEP_ORG);");
    expect(read("app/coach-landing/route.ts")).toContain("let target = COACH_PHONE_LANDING;");
    expect(COACH_PHONE_LANDING).toBe("/my-space?view=client");
  });
});

describe("the phone redirects", () => {
  it("coach Home and business pages open Spotlight in their own app; calendar pages open their own Calendar", () => {
    expect(PHONE_SPOTLIGHT).toBe("/my-space?view=client&spot=1");
    expect(PHONE_CALENDAR).toBe("/my-space?view=client&to=calendar");
    expect(phoneCoachRedirect(`/groups/${S}/business`)).toMatchObject({ to: PHONE_SPOTLIGHT, home: true, groupId: S });
    expect(phoneCoachRedirect(`/groups/${S}/group-calendar`)?.to).toBe(PHONE_CALENDAR);
  });
  it("a team-sport group's coach keeps the team Home: the middleware sends a coach-Home redirect to the group's page", () => {
    const mw = read("lib/supabase/middleware.ts");
    expect(mw).toContain("if (phoneTarget.home && phoneTarget.groupId) {");
    expect(mw).toContain('.select("team_mode").eq("id", phoneTarget.groupId)');
    expect(mw).toContain("to = `/groups/${phoneTarget.groupId}`;");
    expect(read("components/coach/mobile/team-coach-phone-home.tsx")).toContain('activeOverride="home" homeHref={`/groups/${groupId}`}');
  });
});

describe("Spotlight", () => {
  const hub = read("components/coach/mobile/coach-spot-hub.tsx");
  it("opens by itself for ?spot=1 and for a notice naming a panel", () => {
    expect(hub).toContain('if (new URLSearchParams(window.location.search).get("spot") === "1" || anchor) {');
    expect(hub).toContain("const anchor = SPOT_OPEN_HASHES.find((h) => window.location.hash === `#${h}`) ?? null;");
  });
  it("Business has the organization's settings and, for a platform admin, their tools; Program has All programs", () => {
    expect(hub).toContain("href={`/groups/${activeGroupId}/settings`}");
    expect(hub).toContain('href="/admin/support"');
    expect(hub).toContain('href="/admin/organizations"');
    expect(hub).toContain("{platformAdmin && (");
    expect(hub).toContain('<a href="/programs"');
  });
  it("on their own space choosing another organization reloads the page instead of leaving it (on a phone, a team organization opens its team Home: lib/home-org.test.ts)", () => {
    expect(hub).toContain("if (!phone || inOrg.length === 0) {\n        window.location.reload();");
    expect(hub).toContain("if (teamHome) window.location.assign(teamHome);\n        else window.location.reload();");
  });
});

describe("their own space", () => {
  it("no rust bar on a phone (hidden by width, so it never flashes); a client keeps it with Back to me", () => {
    const b = read("components/athlete/acting-as-banner.tsx");
    expect(b).toContain('${self ? "hidden lg:flex" : "flex"}');
    expect(b).toContain('phone ? "← Back to me" : "← Back to coach home"');
  });
  it("Calendar: the organization's sessions and their own workouts on the same days, their undated programs as cards", () => {
    const body = read("components/coach/calendar-page-body.tsx");
    expect(body).toContain("if (showMobileView && isActingAsOther && athleteId === user.id && !bodyOrgId) {");
    expect(body).toContain("own={{ byDay, upcoming: upcomingMine }}");
    expect(body).toContain("<UndatedProgramCards groupId={params.groupId} programs={mine.undated} visuals={visualsMine} />");
    const sched = read("components/coach/mobile/coach-phone-schedule.tsx");
    expect(sched).toContain("text: `You: ${w.title}`");
    expect(sched).toContain('.eq("coach_id", userId)');
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx")).toContain("if (isActingAsOther && athleteId === user.id && !(await orgIdOfGroup(supabase, params.groupId))) redirect(`/groups/${params.groupId}/calendar`);");
  });
  it("the coach's phone calendar (no client being booked) is their own Calendar", () => {
    expect(read("components/coach/calendar-page-body.tsx")).toContain("if (!searchParams.scheduleFor) {\n      redirect(PHONE_CALENDAR");
  });
  it("Settings and Nutrition treat them as themself, not as someone viewing a client", () => {
    expect(read("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("const viewingOther = effective.isActingAsOther && athleteId !== user.id;");
    expect(read("app/(coach)/groups/[groupId]/nutrition/page.tsx")).toContain("const viewingOther = isActingAsOther && athleteId !== user.id;");
  });
  it("there is no coach bar and no More list anywhere", () => {
    expect(read("components/athlete/bottom-tab-bar.tsx")).toContain('variant?: "athlete" | "own";');
    expect(() => read("components/coach/mobile/coach-more-sheet.tsx")).toThrow();
    expect(() => read("components/coach/mobile/coach-nav-links-list.tsx")).toThrow();
    expect(() => read("components/coach/mobile/coach-mobile-home.tsx")).toThrow();
  });
});

describe("Release 2 follow-ups (Oct 20)", () => {
  it("/dashboard on a phone goes to the landing decision in the middleware, before the page (and its loading screen) renders", () => {
    // in the organization already chosen (Oct 21): only a fresh open starts in the home organization
    expect(phoneCoachRedirect("/dashboard")).toEqual({ to: "/coach-landing?keep=org", groupId: null, shared: false });
  });
  it("a group's own page sends a coach (not acting as a client) to their own app; a team-sport group's team Home stays (no redirect to itself)", () => {
    expect(phoneCoachRedirect(`/groups/${S}`)).toEqual({ to: "/my-space?view=client", groupId: S, shared: true, home: true });
    expect(read("lib/supabase/middleware.ts")).toContain("if (to !== pathname) {");
  });
  it("in their own space on a phone the separate bell is hidden (notices live in Spotlight); at a computer it stays", () => {
    expect(read("components/group/group-hub-header.tsx")).toContain('<span className="hidden lg:inline-flex" data-bell-computer-only>');
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).toContain("bellOnComputerOnly={isActingAsOther && !!user && athleteId === user.id && (group as { organization_id?: string | null }).organization_id == null}");
  });
});
