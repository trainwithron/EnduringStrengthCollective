import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isPhoneView, phoneCoachRedirect } from "./phone-coach-routes";
import { teamPhoneHome } from "./team-phone-home";

// One real phone app for coaches (Ron, Oct 19: today's phone app is "the full desktop version with a cutesy view-desktop button"). A short fixed list of places; any other coach page opened on a phone
// goes to the closest of them.
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const G = "6f1c2b3a-0000-4000-8000-000000000001";
const ID = "11111111-2222-4333-8444-555555555555";

// Every coach page a phone keeps as a page (route folders under app/(coach), "[x]" for a dynamic part).
const NEVER = new Set([
  "/calendar",
  "/clients",
  "/clients/requests",
  "/dashboard", // the page itself sends a phone to the phone Home
  "/programs",
  "/groups/[groupId]",
  "/groups/[groupId]/clients",
  "/groups/[groupId]/athletes/[athleteId]",
  "/groups/[groupId]/athletes/[athleteId]/log",
  "/groups/[groupId]/athletes/[athleteId]/log/[workoutId]",
  "/groups/[groupId]/calendar",
  "/groups/[groupId]/calendar/[date]",
  "/groups/[groupId]/team/calendar",
  "/groups/[groupId]/team/calendar/games/[gameId]",
  "/groups/[groupId]/messages",
  "/groups/[groupId]/messages/[otherId]",
  "/groups/[groupId]/feed",
  "/groups/[groupId]/nutrition",
  "/groups/[groupId]/nutrition/nutrients/[key]",
  "/groups/[groupId]/settings",
  "/groups/[groupId]/programs", // the page itself sends a phone to /programs
  "/groups/[groupId]/programs/[programId]",
  "/groups/[groupId]/programs/new",
  "/groups/[groupId]/programs/[programId]/calendar",
  "/groups/[groupId]/programs/[programId]/calendar/[date]",
  "/groups/[groupId]/attendance",
  "/groups/[groupId]/kiosk",
  "/groups/[groupId]/kiosk/settings",
  "/groups/[groupId]/display",
  "/groups/[groupId]/billing/success", // the return from a checkout must land where it was sent
  "/groups/[groupId]/billing/canceled",
]);

// A client's own pages: never a coach redirect.
const CLIENT_ONLY = [
  "about-you", "classes", "goal", "leaderboard", "more", "my-history", "my-schedule", "progress-photos", "recipes", "today",
  "tools/macro-calculator", "transformation/new", "video-checkins", "workouts/[workoutId]",
].map((p) => `/groups/[groupId]/${p}`);

const sample = (route: string) => route.replace("[groupId]", G).replace("[date]", "2026-10-21").replace(/\[[^\]]+\]/g, ID);

function coachRoutes(): string[] {
  const base = join(root, "app", "(coach)");
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n === "page.tsx" ? [d] : []));
  return walk(base).map((d) => "/" + relative(base, d).split(sep).join("/")).map((r) => (r === "/" ? r : r.replace(/\/$/, "")));
}

describe("every coach page has a place on the phone", () => {
  const routes = coachRoutes();
  it("finds the coach pages", () => {
    expect(routes.length).toBeGreaterThan(80);
  });
  it("each page is either one of the phone's places, a client's own page, or goes somewhere (a new page fails here until it is placed)", () => {
    for (const r of routes) {
      const target = phoneCoachRedirect(sample(r));
      if (NEVER.has(r) || CLIENT_ONLY.includes(r)) expect(target, r).toBeNull();
      else expect(target, `${r} is not placed: add it to the table in lib/phone-coach-routes.ts or to NEVER here`).not.toBeNull();
    }
  });
  it("every place a phone is sent is a page that stays (no chains, no loops)", () => {
    for (const r of routes) {
      const target = phoneCoachRedirect(sample(r));
      if (!target) continue;
      const [path, query] = target.to.split("?");
      expect(phoneCoachRedirect(path, query ? `?${query}` : ""), `${r} -> ${target.to}`).toBeNull();
    }
  });
});

describe("the table", () => {
  const to = (p: string, s = "") => phoneCoachRedirect(p, s)?.to ?? null;
  it("sends the computer pages to the closest phone place, in the same group", () => {
    expect(to("/calendar", "?tab=availability")).toBe("/calendar");
    expect(to("/calendar")).toBeNull();
    expect(to("/calendar", "?tab=day")).toBeNull();
    expect(to("/group-calendar")).toBe("/calendar");
    expect(to("/recurring-conflicts")).toBe("/calendar");
    expect(to("/running-low")).toBe("/clients");
    expect(to(`/groups/${G}/business`)).toBe(`/groups/${G}`);
    expect(to(`/groups/${G}/dashboard`)).toBe(`/groups/${G}`);
    expect(to(`/groups/${G}/coaches/${ID}`)).toBe(`/groups/${G}`);
    expect(to(`/groups/${G}/business/booking-page`)).toBe(`/groups/${G}/calendar`);
    expect(to(`/groups/${G}/availability`)).toBe(`/groups/${G}/calendar`);
    expect(to(`/groups/${G}/business/session-ledger`)).toBe(`/groups/${G}/clients`);
    expect(to(`/groups/${G}/business/sms-settings`)).toBe(`/groups/${G}/settings`);
    expect(to(`/groups/${G}/branding`)).toBe(`/groups/${G}/settings`);
    expect(to(`/groups/${G}/messages/announce`)).toBe(`/groups/${G}/messages`);
    expect(to(`/groups/${G}/team-activity`)).toBe(`/groups/${G}/feed`);
    expect(to(`/groups/${G}/challenges/${ID}`)).toBe(`/groups/${G}/feed`);
    expect(to(`/groups/${G}/games/${ID}`)).toBe(`/groups/${G}/feed`);
    expect(to(`/groups/${G}/resources`)).toBe(`/groups/${G}`);
    expect(to(`/groups/${G}/exercise-library`)).toBe("/programs");
    expect(to(`/groups/${G}/workouts/${ID}/clients`)).toBe("/programs");
    expect(to(`/groups/${G}/tools/one-rep-max`)).toBe("/programs");
    expect(to(`/groups/${G}/programs/${ID}/progressions`)).toBe(`/groups/${G}/programs/${ID}`);
    expect(to(`/groups/${G}/athletes/${ID}/calendar`)).toBe(`/groups/${G}/athletes/${ID}?tab=calendar`);
    expect(to(`/groups/${G}/athletes/${ID}/calendar/2026-10-21`)).toBe(`/groups/${G}/athletes/${ID}?tab=calendar`);
    expect(to(`/groups/${G}/athletes/${ID}/history`)).toBe(`/groups/${G}/athletes/${ID}`);
    expect(to(`/groups/${G}/athletes/${ID}/view`)).toBe(`/groups/${G}/athletes/${ID}`);
  });
  it("keeps the in-person pages and the program builder", () => {
    for (const p of [`/groups/${G}/attendance`, `/groups/${G}/kiosk`, `/groups/${G}/kiosk/settings`, `/groups/${G}/display`, `/groups/${G}/programs/${ID}`, `/groups/${G}/athletes/${ID}/log`, `/groups/${G}/today`, "/programs", "/clients"]) {
      expect(phoneCoachRedirect(p), p).toBeNull();
    }
    expect(phoneCoachRedirect(`/groups/${G}/programs/${ID}`, "?edit=1")).toBeNull();
  });
  it("marks the pages clients use too, which are left alone while the coach is acting as a client", () => {
    for (const p of ["challenges", `challenges/${ID}`, "records", `games/${ID}`, "resources", "quick-tips", "pro-shop", "referrals", "tools/one-rep-max"]) {
      expect(phoneCoachRedirect(`/groups/${G}/${p}`)?.shared, p).toBe(true);
    }
    expect(phoneCoachRedirect(`/groups/${G}/business`)?.shared).toBe(false);
    expect(phoneCoachRedirect(`/groups/${G}/business`)?.groupId).toBe(G);
    expect(phoneCoachRedirect("/running-low")?.groupId).toBeNull();
  });
  it("leaves everything that is not a coach page alone", () => {
    for (const p of ["/", "/login", "/api/x", "/admin/support", "/notifications", "/my-space", `/sessions/${ID}`]) expect(phoneCoachRedirect(p), p).toBeNull();
  });
});

describe("isPhoneView: one rule", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
  const android = "Mozilla/5.0 (Linux; Android 15; SM-S938U) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
  const desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
  it("a phone, or the installed app, is the phone app; a computer is not", () => {
    expect(isPhoneView({ override: null, standalone: null, userAgent: iphone })).toBe(true);
    expect(isPhoneView({ override: null, standalone: null, userAgent: android })).toBe(true);
    expect(isPhoneView({ override: null, standalone: null, userAgent: desktop })).toBe(false);
    expect(isPhoneView({ override: null, standalone: "1", userAgent: desktop })).toBe(true);
  });
  it("a saved choice wins both ways", () => {
    expect(isPhoneView({ override: "desktop", standalone: "1", userAgent: iphone })).toBe(false);
    expect(isPhoneView({ override: "mobile", standalone: null, userAgent: desktop })).toBe(true);
  });
  it("the pages use the same rule as the middleware", () => {
    const pwa = read("lib/pwa-server.ts");
    expect(pwa).toContain('import { isPhoneView, isTabletUA } from "./phone-coach-routes";');
    expect(pwa.slice(pwa.indexOf("export async function prefersAthleteStyleView"))).toContain("return isPhoneView({");
  });
});

describe("the middleware sends the phone", () => {
  const mw = read("lib/supabase/middleware.ts");
  const block = mw.slice(mw.indexOf("One real phone app for coaches"), mw.indexOf("return phoneResponse;") + 30);
  it("right after the My training exit, before the workspace cookie", () => {
    expect(mw.indexOf("shouldLeaveMyTraining(pathname")).toBeLessThan(mw.indexOf("One real phone app for coaches"));
    expect(mw.indexOf("One real phone app for coaches")).toBeLessThan(mw.indexOf("const pageGroup = user && request.method"));
  });
  it("page loads only, never the API or a frame (the computer's panes and split half show any page)", () => {
    expect(block).toContain('request.method === "GET"');
    expect(block).toContain('!pathname.startsWith("/api/")');
    expect(block).toContain('request.headers.get("sec-fetch-dest") !== "iframe"');
  });
  it("only a person who coaches that group, never while acting as a client on a shared page, and the cookies go with it", () => {
    expect(block).toContain('isCoach = (seat as { role?: string } | null)?.role === "coach";');
    expect(block).toContain(".eq(\"group_id\", phoneTarget.groupId).eq(\"profile_id\", user.id)");
    expect(block).toContain("!(phoneTarget.shared && request.cookies.get(MY_TRAINING_COOKIES.actingAs)?.value)");
    expect(block).toContain("phoneResponse.cookies.set(cookie);");
  });
});

describe("the phone's menus only offer the phone's places", () => {
  it("every link in the More list stays a page on the phone", () => {
    const list = read("components/coach/mobile/coach-nav-links-list.tsx");
    const hrefs = [...list.matchAll(/href=(?:"([^"]+)"|\{`([^`]+)`\})/g)].map((m) => (m[1] ?? m[2]).replace("${groupId}", G));
    expect(hrefs.length).toBeGreaterThan(3);
    for (const h of hrefs) expect(phoneCoachRedirect(h.split("?")[0], h.includes("?") ? `?${h.split("?")[1]}` : ""), h).toBeNull();
  });
  it("every link on the team-sport phone Home stays a page on the phone", () => {
    const home = teamPhoneHome({ groupId: G, programs: [{ id: ID, name: "P", workouts: [] }] });
    for (const l of [...home.links, ...home.moreLinks, ...home.programs.map((p) => ({ href: p.href }))]) expect(phoneCoachRedirect(l.href), l.href).toBeNull();
    expect(home.moreLinks.map((l) => l.label)).toEqual(["All programs", "Nutrition"]);
    expect(home.links.map((l) => l.label)[2]).toBe("Attendance");
  });
  it("no Desktop mode anywhere in the phone app, and the switch itself is gone", () => {
    const dir = join(root, "components", "coach", "mobile");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx") && !n.includes(".test."))) {
      const s = readFileSync(join(dir, f), "utf8");
      expect(s, f).not.toContain("ViewModeToggle");
      expect(s, f).not.toContain("Desktop mode");
    }
    expect(() => statSync(join(root, "components", "coach", "view-mode-toggle.tsx"))).toThrow();
  });
  it("the client app's Settings sends a coach to Coach home", () => {
    const settings = read("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(settings).toContain("Coach home →");
    expect(settings).not.toContain("the full site.");
  });
});

describe("one shell on the phone", () => {
  it("a coach on the feed, a conversation, a program's calendar and the notifications page gets the coach bar, not the client's", () => {
    expect(read("app/(coach)/groups/[groupId]/feed/page.tsx")).toContain("isCoach && !isActingAsOther ? <CoachMobileShell");
    expect(read("app/(coach)/groups/[groupId]/messages/[otherId]/page.tsx")).toContain("viewerIsCoach && showMobileView ? (");
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx").match(/<CoachMobileShell groupId=\{params.groupId\} groupName="" activeOverride="calendar">/g)?.length).toBe(2);
    expect(read("app/notifications/page.tsx")).toContain("if (isCoach && coachAnchor && (await prefersAthleteStyleView())) {");
  });
});

describe("Assign works on the phone", () => {
  it("the phone program view has the builder's own Assign to clients button and panel, for the coach's own view only", () => {
    const picker = read("components/shared/program-day-picker.tsx");
    expect(picker).toContain('import { ProgramAssignPanel } from "@/components/coach/desktop/program-assign-panel";');
    expect(picker).toContain("{assign && <AssignToClients {...assign} />}");
    expect(picker).toContain("Assign to clients");
    const plain = read("components/shared/program-plain-view-server.tsx");
    expect(plain).toContain("const canAssign = isCoach && !workoutHrefBase;");
    expect(plain).toContain('.select("ai_draft")');
  });
  it("the client profile's program tab still has its own actions", () => {
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).toContain("ClientProgramActions");
  });
});
