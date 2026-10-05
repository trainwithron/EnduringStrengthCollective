import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NAV_DESTINATIONS, resolveNavigation, type NavContext } from "@/lib/nav-intents";
import { HOWTOS } from "@/lib/howto-library";

const ROOT = path.resolve(__dirname, "..");

function routeExists(template: string): boolean {
  const rel = template.replace("{groupId}", "[groupId]").replace("{athleteId}", "[athleteId]").replace(/^\//, "");
  return fs.existsSync(path.join(ROOT, "app", rel, "page.tsx"));
}

describe("route table", () => {
  it("every destination points at a real page", () => {
    const missing = NAV_DESTINATIONS.flatMap((d) => [d.path, d.phonePath].filter((p): p is string => !!p)).filter((p) => !routeExists(p));
    expect(missing).toEqual([]);
  });

  it("every how-to step link points at a real page", () => {
    const missing = HOWTOS.flatMap((h) => h.steps.map((s) => s.href).filter((p): p is string => !!p)).filter((p) => !routeExists(p));
    expect(missing).toEqual([]);
  });

  it("destination ids are unique", () => {
    const ids = NAV_DESTINATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

const roster = [
  { id: "a-jordan", fullName: "Jordan Smith" },
  { id: "a-sam", fullName: "Sam Lee" },
  { id: "a-alex1", fullName: "Alex Rivera" },
  { id: "a-alex2", fullName: "Alex Chen" },
];

const coachDesktop: NavContext = { role: "coach", device: "desktop", groupId: "g1", roster };
const coachPhone: NavContext = { role: "coach", device: "phone", groupId: "g1", roster };
const athletePhone: NavContext = { role: "athlete", device: "phone", groupId: "g1" };

function firstHref(message: string, ctx: NavContext): string | null {
  const r = resolveNavigation(message, ctx);
  if (r.kind === "data") return null;
  return r.chips[0]?.href ?? null;
}

// [phrasing, expected first link]
const COACH_DESKTOP: [string, string][] = [
  ["show me my calendar", "/groups/g1/calendar"],
  ["open the calendar", "/groups/g1/calendar"],
  ["calendar", "/groups/g1/calendar"],
  ["where is my schedule", "/groups/g1/calendar"],
  ["go to bookings", "/groups/g1/calendar"],
  ["upcoming appointments", "/groups/g1/calendar"],
  ["take me home", "/dashboard"],
  ["home", "/dashboard"],
  ["go to the dashboard", "/dashboard"],
  ["main page", "/dashboard"],
  ["clients", "/groups/g1/clients"],
  ["show my clients", "/groups/g1/clients"],
  ["client list", "/groups/g1/clients"],
  ["open roster", "/groups/g1/clients"],
  ["where are my athletes", "/groups/g1/clients"],
  ["messages", "/groups/g1/messages"],
  ["open my inbox", "/groups/g1/messages"],
  ["direct messages", "/groups/g1/messages"],
  ["message everyone", "/groups/g1/messages/announce"],
  ["send an announcement", "/groups/g1/messages/announce"],
  ["bulk message", "/groups/g1/messages/announce"],
  ["broadcast to all clients", "/groups/g1/messages/announce"],
  ["programs", "/groups/g1/programs"],
  ["show my programs", "/groups/g1/programs"],
  ["open the program builder", "/groups/g1/programs"],
  ["build a new program", "/groups/g1/programs/new"],
  ["create a program", "/groups/g1/programs/new"],
  ["new program", "/groups/g1/programs/new"],
  ["import a program", "/groups/g1/programs/import"],
  ["upload a program", "/groups/g1/programs/import"],
  ["exercise library", "/groups/g1/exercise-library"],
  ["add an exercise", "/groups/g1/exercise-library"],
  ["my exercises", "/groups/g1/exercise-library"],
  ["nutrition", "/groups/g1/nutrition"],
  ["meal plans", "/groups/g1/nutrition"],
  ["macros", "/groups/g1/nutrition"],
  ["recipes", "/groups/g1/recipes"],
  ["macro calculator", "/groups/g1/tools/macro-calculator"],
  ["1rm calculator", "/groups/g1/tools/one-rep-max"],
  ["one rep max", "/groups/g1/tools/one-rep-max"],
  ["records", "/groups/g1/records"],
  ["personal records", "/groups/g1/records"],
  ["team feed", "/groups/g1/feed"],
  ["open the feed", "/groups/g1/feed"],
  ["leaderboard", "/groups/g1/leaderboard"],
  ["challenges", "/groups/g1/challenges"],
  ["video check ins", "/groups/g1/video-checkins"],
  ["form checks", "/groups/g1/video-checkins"],
  ["availability", "/groups/g1/availability"],
  ["set my hours", "/groups/g1/availability"],
  ["working hours", "/groups/g1/availability"],
  ["business", "/groups/g1/business"],
  ["revenue", "/groups/g1/business"],
  ["how much am i making", "/groups/g1/business"],
  ["packages", "/groups/g1/business/packages"],
  ["set my prices", "/groups/g1/business/packages"],
  ["session ledger", "/groups/g1/business/session-ledger"],
  ["who owes sessions", "/groups/g1/business/session-ledger"],
  ["session balances", "/groups/g1/business/session-ledger"],
  ["leads", "/groups/g1/business/leads"],
  ["text message settings", "/groups/g1/business/sms-settings"],
  ["sms settings", "/groups/g1/business/sms-settings"],
  ["waiver", "/groups/g1/business/waiver"],
  ["edit my waiver", "/groups/g1/business/waiver"],
  ["zapier", "/groups/g1/business/zapier"],
  ["contact support", "/groups/g1/business/support"],
  ["i need help", "/groups/g1/business/support"],
  ["revenue splits", "/groups/g1/revenue-splits"],
  ["branding", "/groups/g1/branding"],
  ["my organization", "/groups/g1/branding"],
  ["change my logo", "/groups/g1/branding"],
  ["invite a coach", "/groups/g1/branding"],
  ["add a trainer", "/groups/g1/branding"],
  ["kiosk", "/groups/g1/kiosk"],
  ["kiosk pins", "/groups/g1/kiosk/settings"],
  ["tv display mode", "/groups/g1/display"],
  ["weight room display", "/groups/g1/display"],
  ["booking page", "/groups/g1/business/booking-page"],
  ["group sessions", "/groups/g1/group-sessions"],
  ["schedule a class with limited spots", "/groups/g1/group-sessions"],
  ["share my booking link", "/groups/g1/business/booking-page"],
  ["let people book online", "/groups/g1/business/booking-page"],
  ["depth chart", "/groups/g1/team"],
  ["team calendar", "/groups/g1/team/calendar"],
  ["team performance", "/groups/g1/team-performance"],
  ["settings", "/groups/g1/settings"],
  ["my settings", "/groups/g1/settings"],
  ["turn on notifications", "/groups/g1/settings"],
  ["sign out", "/groups/g1/settings"],
  ["report a problem", "/groups/g1/settings"],
  ["send feedback", "/groups/g1/settings"],
  ["referrals", "/groups/g1/referrals"],
  ["find a coach", "/find-a-coach"],
  ["pro shop", "/groups/g1/resources"],
  ["open jordan's profile", "/groups/g1/athletes/a-jordan"],
  ["jordan smith", "/groups/g1/athletes/a-jordan"],
  ["go to sam", "/groups/g1/athletes/a-sam"],
  ["show me sam lee's calendar", "/groups/g1/athletes/a-sam/calendar"],
  ["schedule sam weekly", "/groups/g1/athletes/a-sam/calendar"],
  ["jordan's workout history", "/groups/g1/athletes/a-jordan/history"],
  ["log a session for jordan", "/groups/g1/athletes/a-jordan/log"],
  ["log an in person session for sam", "/groups/g1/athletes/a-sam/log"],
  ["open smith's page", "/groups/g1/athletes/a-jordan"],
  ["PLEASE show me my CALENDAR!!", "/groups/g1/calendar"],
  ["can you take me to the clients page", "/groups/g1/clients"],
  ["i want to see my programs", "/groups/g1/programs"],
  ["where do i set my availability", "/groups/g1/availability"],
  ["how do i send an announcement", "/groups/g1/messages/announce"],
  ["how do i add a client", "/groups/g1/clients"],
  ["how do i assign sessions", "/groups/g1/clients"],
  ["how do i set a balance to 0", "/groups/g1/clients"],
  ["how do i mark a session attended", "/groups/g1/calendar"],
  ["how do i create a package", "/groups/g1/business/packages"],
  ["how do i book weekly sessions", "/groups/g1/clients"],
  ["how do i assign a program to a client", "/groups/g1/programs"],
  ["how do i send a client their sign in link", "/groups/g1/clients"],
  ["how do i set a standing macro target", "/groups/g1/clients"],
  ["how do i message all my clients", "/groups/g1/messages/announce"],
];

const COACH_PHONE: [string, string][] = [
  ["home", "/groups/g1"],
  ["take me home", "/groups/g1"],
  ["open the dashboard", "/groups/g1"],
  ["clients", "/groups/g1/clients"],
  ["my clients", "/groups/g1/clients"],
  ["calendar", "/groups/g1/calendar"],
  ["show my schedule", "/groups/g1/calendar"],
  ["messages", "/groups/g1/messages"],
  ["open my inbox", "/groups/g1/messages"],
  ["message everyone", "/groups/g1/messages/announce"],
  ["send an announcement", "/groups/g1/messages/announce"],
  ["programs", "/groups/g1/programs"],
  ["nutrition", "/groups/g1/nutrition"],
  ["macros", "/groups/g1/nutrition"],
  ["records", "/groups/g1/records"],
  ["team feed", "/groups/g1/feed"],
  ["settings", "/groups/g1/settings"],
  ["sign out", "/groups/g1/settings"],
  ["report a problem", "/groups/g1/settings"],
  ["leaderboard", "/groups/g1/leaderboard"],
  ["open jordan's profile", "/groups/g1/athletes/a-jordan"],
  ["go to sam lee", "/groups/g1/athletes/a-sam"],
  ["log a session for jordan", "/groups/g1/athletes/a-jordan/log"],
  ["jordan's workout history", "/groups/g1/athletes/a-jordan/history"],
  ["show me the 1rm calculator", "/groups/g1/tools/one-rep-max"],
  ["macro calculator", "/groups/g1/tools/macro-calculator"],
  ["recipes", "/groups/g1/recipes"],
  ["challenges", "/groups/g1/challenges"],
  ["video check ins", "/groups/g1/video-checkins"],
  ["pro shop", "/groups/g1/resources"],
  ["find a coach", "/find-a-coach"],
  ["can you take me to the clients page", "/groups/g1/clients"],
  ["i want to see my calendar", "/groups/g1/calendar"],
  ["where are my messages", "/groups/g1/messages"],
  ["show me my athletes", "/groups/g1/clients"],
  ["roster", "/groups/g1/clients"],
  ["bookings", "/groups/g1/calendar"],
  ["my feed", "/groups/g1/feed"],
  ["notifications", "/groups/g1/settings"],
  ["feedback", "/groups/g1/settings"],
];

const ATHLETE_PHONE: [string, string][] = [
  ["home", "/groups/g1"],
  ["take me home", "/groups/g1"],
  ["main page", "/groups/g1"],
  ["today", "/groups/g1/today"],
  ["start my workout", "/groups/g1/today"],
  ["todays workout", "/groups/g1/today"],
  ["what is my workout", "/groups/g1/today"],
  ["workout", "/groups/g1/today"],
  ["i want to train", "/groups/g1/today"],
  ["log a workout", "/groups/g1/today"],
  ["calendar", "/groups/g1/calendar"],
  ["my calendar", "/groups/g1/calendar"],
  ["my schedule", "/groups/g1/calendar"],
  ["book a session", "/groups/g1/calendar"],
  ["when am i booked", "/groups/g1/calendar"],
  ["upcoming sessions", "/groups/g1/calendar"],
  ["messages", "/groups/g1/messages"],
  ["message my coach", "/groups/g1/messages"],
  ["talk to my coach", "/groups/g1/messages"],
  ["my inbox", "/groups/g1/messages"],
  ["programs", "/groups/g1/programs"],
  ["my programs", "/groups/g1/programs"],
  ["nutrition", "/groups/g1/nutrition"],
  ["my macros", "/groups/g1/nutrition"],
  ["meal plan", "/groups/g1/nutrition"],
  ["what should i eat", "/groups/g1/nutrition"],
  ["recipes", "/groups/g1/recipes"],
  ["records", "/groups/g1/records"],
  ["my prs", "/groups/g1/records"],
  ["personal bests", "/groups/g1/records"],
  ["feed", "/groups/g1/feed"],
  ["team feed", "/groups/g1/feed"],
  ["leaderboard", "/groups/g1/leaderboard"],
  ["challenges", "/groups/g1/challenges"],
  ["video check ins", "/groups/g1/video-checkins"],
  ["form check", "/groups/g1/video-checkins"],
  ["progress photos", "/groups/g1/progress-photos"],
  ["my photos", "/groups/g1/progress-photos"],
  ["my history", "/groups/g1/my-history"],
  ["past workouts", "/groups/g1/my-history"],
  ["workout history", "/groups/g1/my-history"],
  ["my goal", "/groups/g1/goal"],
  ["change my goal", "/groups/g1/goal"],
  ["set a goal", "/groups/g1/goal"],
  ["training partner", "/partners"],
  ["find a partner", "/partners"],
  ["settings", "/groups/g1/settings"],
  ["turn on notifications", "/groups/g1/settings"],
  ["sign out", "/groups/g1/settings"],
  ["log out", "/groups/g1/settings"],
  ["change my name", "/groups/g1/settings"],
  ["report a problem", "/groups/g1/settings"],
  ["send feedback", "/groups/g1/settings"],
  ["1rm calculator", "/groups/g1/tools/one-rep-max"],
  ["estimate my max", "/groups/g1/tools/one-rep-max"],
  ["macro calculator", "/groups/g1/tools/macro-calculator"],
  ["resources", "/groups/g1/resources"],
  ["quick tips", "/groups/g1/quick-tips"],
  ["PLEASE open my CALENDAR", "/groups/g1/calendar"],
  ["can you take me to my workout", "/groups/g1/today"],
  ["i need to see my schedule", "/groups/g1/calendar"],
  ["where do i log my workout", "/groups/g1/today"],
  ["how do i start my workout", "/groups/g1/today"],
  ["how do i book a session", "/groups/g1/calendar"],
  ["show me my prs", "/groups/g1/records"],
  ["go to the feed", "/groups/g1/feed"],
  ["find a coach", "/find-a-coach"],
  ["where is my coach's message", "/groups/g1/messages"],
  ["when is my next session", "/groups/g1/calendar"],
  ["dm", "/groups/g1/messages"],
  ["show leaderboard", "/groups/g1/leaderboard"],
  ["see my progress photos", "/groups/g1/progress-photos"],
  ["upload a progress photo", "/groups/g1/progress-photos"],
  ["what are my macros today", "/groups/g1/nutrition"],
  ["workout of the day", "/groups/g1/today"],
  ["classes", "/groups/g1/classes"],
  ["join a class", "/groups/g1/classes"],
  ["my account", "/groups/g1/settings"],
  ["preferences", "/groups/g1/settings"],
  ["push notifications", "/groups/g1/settings"],
  ["community", "/groups/g1/feed"],
  ["rankings", "/groups/g1/leaderboard"],
  ["tips", "/groups/g1/quick-tips"],
  ["what did i do last week", "/groups/g1/my-history"],
  ["previous workouts", "/groups/g1/my-history"],
  ["my logs", "/groups/g1/my-history"],
  ["before and after", "/groups/g1/progress-photos"],
  ["gym buddy", "/partners"],
  ["workout partner", "/partners"],
  ["start training", "/groups/g1/today"],
  ["reserve a time", "/groups/g1/calendar"],
  ["make an appointment", "/groups/g1/calendar"],
  ["appointments", "/groups/g1/calendar"],
  ["training programs", "/groups/g1/programs"],
  ["diet", "/groups/g1/nutrition"],
  ["calories", "/groups/g1/nutrition"],
  ["food", "/groups/g1/nutrition"],
  ["contests", "/groups/g1/challenges"],
  ["competition", "/groups/g1/challenges"],
  ["who is leading", "/groups/g1/leaderboard"],
  ["top lifters", "/groups/g1/leaderboard"],
  ["texts", "/groups/g1/messages"],
  ["chat", "/groups/g1/messages"],
  ["overview", "/groups/g1"],
  ["start page", "/groups/g1"],
  ["dashboard", "/groups/g1"],
];

describe("phrasing: coach on desktop", () => {
  it.each(COACH_DESKTOP)("%s", (phrase, expected) => {
    expect(firstHref(phrase, coachDesktop)).toBe(expected);
  });
  it("has at least 100 phrasings", () => {
    expect(COACH_DESKTOP.length).toBeGreaterThanOrEqual(100);
  });
});

describe("phrasing: coach on a phone", () => {
  it.each(COACH_PHONE)("%s", (phrase, expected) => {
    expect(firstHref(phrase, coachPhone)).toBe(expected);
  });
});

describe("phrasing: athlete on a phone", () => {
  it.each(ATHLETE_PHONE)("%s", (phrase, expected) => {
    expect(firstHref(phrase, athletePhone)).toBe(expected);
  });
  it("has at least 100 phrasings", () => {
    expect(ATHLETE_PHONE.length).toBeGreaterThanOrEqual(100);
  });
});

describe("never a dead end", () => {
  const gibberish = ["asdf", "???", "blorp the zonk", "qwerty uiop", "zzz", "a", "the", "1234567"];
  it.each(gibberish)("%s still gives somewhere to go", (g) => {
    for (const ctx of [coachDesktop, coachPhone, athletePhone]) {
      const r = resolveNavigation(g, ctx);
      if (r.kind === "data") continue;
      expect(r.chips.length).toBeGreaterThan(0);
    }
  });

  it("an empty message gives the main places", () => {
    const r = resolveNavigation("   ", coachDesktop);
    expect(r.kind).toBe("unsure");
    if (r.kind !== "data") expect(r.chips.length).toBeGreaterThan(0);
  });

  it("without a group id it never returns a broken link", () => {
    const r = resolveNavigation("show me my calendar", { role: "coach", device: "desktop", groupId: null, roster });
    if (r.kind !== "data") for (const c of r.chips) expect(c.href).not.toContain("//");
  });
});

describe("role and device awareness", () => {
  it("a coach-only page is never offered to an athlete", () => {
    const r = resolveNavigation("revenue", athletePhone);
    if (r.kind !== "data") for (const c of r.chips) expect(c.href).not.toContain("/business");
  });

  it("a desktop-only page asked from a phone is explained, with other places offered", () => {
    const r = resolveNavigation("create a package", coachPhone);
    expect(r.kind).toBe("unsure");
    if (r.kind !== "data") {
      expect(r.text.toLowerCase()).toContain("desktop");
      expect(r.chips.length).toBeGreaterThan(0);
    }
  });

  it("the coach phone Home is the group page", () => {
    expect(firstHref("home", coachPhone)).toBe("/groups/g1");
    expect(firstHref("home", coachDesktop)).toBe("/dashboard");
  });
});

describe("clients by name", () => {
  it("two clients with the same first name offer both", () => {
    const r = resolveNavigation("open alex's profile", coachDesktop);
    expect(r.kind).toBe("navigate");
    if (r.kind === "navigate") {
      expect(r.chips.map((c) => c.href).sort()).toEqual(["/groups/g1/athletes/a-alex1", "/groups/g1/athletes/a-alex2"]);
    }
  });

  it("this client resolves from the page the coach is on", () => {
    const r = resolveNavigation("show their calendar", { ...coachDesktop, currentAthleteId: "a-sam" });
    expect(r.kind).toBe("navigate");
    if (r.kind === "navigate") expect(r.chips[0].href).toBe("/groups/g1/athletes/a-sam/calendar");
  });

  it("an athlete does not get client pages even when a name matches", () => {
    const r = resolveNavigation("open jordan's profile", { ...athletePhone, roster });
    if (r.kind !== "data") for (const c of r.chips) expect(c.href).not.toContain("/athletes/");
  });
});

describe("how-to answers", () => {
  const cases: [string, string][] = [
    ["how do i assign sessions", "assign-sessions"],
    ["how do i give a client sessions", "assign-sessions"],
    ["my client paid in person, how do i add sessions", "assign-sessions"],
    ["how do i set a balance to 0", "set-balance"],
    ["the balance is wrong, how do i fix it", "set-balance"],
    ["how do i mark a session attended", "mark-attended"],
    ["how do i add a client before they sign up", "add-client-before-signup"],
    ["how do i send a client their sign in link", "send-signin-link"],
    ["my client can't sign in", "send-signin-link"],
    ["how do i message all my clients", "bulk-message"],
    ["how do i set a standing macro target", "standing-macros"],
    ["how do i assign a program to a client", "assign-program"],
    ["how do i create a package", "create-package"],
    ["how do i book a client weekly", "book-weekly"],
    ["how do i set up a booking page", "booking-page"],
    ["how do i run a small group session with spots", "group-session"],
    ["how do i let people book without an account", "booking-page"],
    ["how do i remind a client to pay", "remind-reup"],
    ["who needs payment", "remind-reup"],
    ["how do i put a client on hold", "remind-reup"],
    ["how do i schedule recurring sessions", "book-weekly"],
  ];
  it.each(cases)("%s", (q, id) => {
    const r = resolveNavigation(q, coachDesktop);
    expect(r.kind).toBe("howto");
    if (r.kind === "howto") expect(r.howto.id).toBe(id);
  });

  it("how-tos cover the planned first ten", () => {
    const coach = HOWTOS.filter((h) => h.roles.includes("coach")).map((h) => h.id);
    expect(coach.length).toBeGreaterThanOrEqual(10);
  });

  it("every how-to has steps and keywords", () => {
    for (const h of HOWTOS) {
      expect(h.steps.length).toBeGreaterThan(0);
      expect(h.keywords.length).toBeGreaterThan(3);
    }
  });
});

describe("data questions go to the assistant", () => {
  const data = [
    "how has sam's squat been trending",
    "who hasn't logged this week",
    "how many sessions did jordan miss",
    "what is the average readiness across my clients",
    "when did alex last train",
    "why is jordan stuck on bench",
  ];
  it.each(data)("%s", (q) => {
    expect(resolveNavigation(q, coachDesktop).kind).toBe("data");
  });
});
