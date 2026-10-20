import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Phone speed, group 3: opening the app is one redirect, and Home and the client profile read in waves. No decision changed.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const db = vi.hoisted(() => ({ rpc: { data: "space-1" as string | null, error: null as { message: string } | null }, seat: { role: "coach" } as { role: string } | null, throws: false }));
vi.mock("@/lib/supabase/server", () => ({
  createCrossOrgServerClient: async () => {
    if (db.throws) throw new Error("boom");
    return {
      rpc: async () => db.rpc,
      from: () => {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: db.seat, error: null }) };
        return chain;
      },
    };
  },
}));

import { openOwnSpaceRedirect } from "./open-own-space";

describe("B7: straight into the coach's own app (openOwnSpaceRedirect)", () => {
  const url = new URL("https://spotlightcoaching.app/coach-landing");
  beforeEach(() => {
    db.rpc = { data: "space-1", error: null };
    db.seat = { role: "coach" };
    db.throws = false;
  });
  it("opens the personal space with the three act-as-yourself cookies, in one response", async () => {
    const res = await openOwnSpaceRedirect({ id: "u1" }, url, new URLSearchParams({ view: "client", to: "calendar", month: "2026-10", spot: "1" }));
    expect(res!.status).toBe(307);
    expect(new URL(res!.headers.get("location")!).pathname + new URL(res!.headers.get("location")!).search).toBe("/groups/space-1/calendar?month=2026-10&spot=1");
    const cookies = res!.headers.getSetCookie().map((c) => c.split("=")[0]);
    expect(cookies).toHaveLength(3);
  });
  it("no seat in the space: My training sorts it out", async () => {
    db.seat = null;
    const res = await openOwnSpaceRedirect({ id: "u1" }, url, new URLSearchParams({ view: "client" }));
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/my-training");
    expect(res!.headers.getSetCookie()).toHaveLength(0);
  });
  it("the space could not be made: the coach dashboard; not a coach: says so", async () => {
    db.rpc = { data: null, error: { message: "network" } };
    expect(new URL((await openOwnSpaceRedirect({ id: "u1" }, url, new URLSearchParams()))!.headers.get("location")!).pathname).toBe("/dashboard");
    db.rpc = { data: null, error: { message: "Only coaches have a personal space." } };
    const res = await openOwnSpaceRedirect({ id: "u1" }, url, new URLSearchParams());
    expect(res!.status).toBe(403);
    expect(await res!.text()).toContain("Only coaches have a personal space.");
  });
  it("something unexpected: null, so the caller falls back to the old hop", async () => {
    db.throws = true;
    expect(await openOwnSpaceRedirect({ id: "u1" }, url, new URLSearchParams())).toBeNull();
  });
  it("/coach-landing uses it only for the coach's own app; the team Home and the chooser are unchanged", () => {
    const route = read("app/coach-landing/route.ts");
    expect(route).toContain("let target = COACH_PHONE_LANDING;");
    expect(route).toContain('if (landing.to === "choose") target = "/choose-organization?next=/coach-landing";');
    expect(route).toContain('else if (landing.to === "coach-home") target = `/groups/${landing.groupId}`;');
    expect(route).toContain('if (target === COACH_PHONE_LANDING) {\n    return (await openOwnSpaceRedirect(user, url, new URLSearchParams({ view: "client" }))) ?? NextResponse.redirect(new URL(COACH_PHONE_LANDING, url));');
    expect(read("app/my-space/route.ts")).toContain("openOwnSpaceRedirect(user, url, url.searchParams)");
  });
});

describe("B8: Home reads in waves", () => {
  const home = read("app/(coach)/groups/[groupId]/page.tsx");
  it("the first wave has the notices, the time zone, the organization's look, the pending coaches and the phone check", () => {
    const waveB = home.slice(home.indexOf("  ] = await Promise.all([\n    supabase.from(\"groups\")"), home.indexOf("if (groupError || !group)"));
    for (const s of ['.from("notifications")', "getGroupCoachTimezone(supabase, params.groupId)", "getViewerOrgTheme(params.groupId)", "pendingCoachIds(params.groupId)", "prefersAthleteStyleView()", "team_mode"]) expect(waveB, s).toContain(s);
  });
  it("a coach who is sent on is sent on before the rest is read", () => {
    expect(home.indexOf("redirect(COACH_PHONE_LANDING);")).toBeLessThan(home.indexOf("// Wave C"));
    expect(home.indexOf('redirect("/dashboard");')).toBeLessThan(home.indexOf("// Wave C"));
  });
  it("the Spot rail's reads only for someone else's view; the bookings check uses the roster's coach; the roster's last logs only for who is shown", () => {
    expect(home).toContain("if (!(isActingAsOther && athleteId && user && athleteId !== user.id)) return none;");
    expect(home).not.toContain("const { data: coachMembership }");
    expect(home).toContain('.in("athlete_id", shownIds)');
    // the classes link counts this organization's classes, like the Classes page
    expect(home).toContain('if (group.organization_id) q = q.eq("organization_id", group.organization_id);');
  });
});

describe("B9: the client profile", () => {
  const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
  it("the address lookup starts with wave 1; the sub-goals and the open organization are in wave 1; the schedules' bookings in wave 2", () => {
    expect(page).toContain("const signInUserPromise = !selfView ? createServiceRoleClient().auth.admin.getUserById(params.athleteId) : null;");
    expect(page.indexOf("const signInUserPromise")).toBeLessThan(page.indexOf("// Wave 1"));
    expect(page).toContain("selfView ? getActiveAnchor(supabase, user.id) : Promise.resolve(null),");
    expect(page).toContain("const open = openAnchor;");
    expect(page).toContain("seriesReads,");
    expect(page).not.toContain("let seriesResult = seriesFirst;\n  if");
  });
});
