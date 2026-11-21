import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { badgeCountOf, countedNotices, soleStartWorkoutId, spotCount, type SpotNeeds } from "./spot-needs";
import { phoneNewProgramHref } from "@/components/coach/mobile/programs-phone-list";

// Clutter and flow, part C1 (Ron, Nov 21: "fix all clutter and flow that arent my call"): the coach's phone Spotlight hub.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const hub = read("components/coach/mobile/coach-spot-hub.tsx");
const top = read("components/coach/mobile/spot-needs-top.tsx");
const panel = read("components/coach/mobile/spot-clients-groups-panel.tsx");
const route = read("app/api/coach/spot-needs/route.ts");

const notice = (type: string) => ({ id: type, type, body: "", linkPath: "/", createdAt: "2026-11-21T10:00:00Z" });
const base: SpotNeeds = { needsChoice: false, groupIds: ["g"], timezone: "UTC", sessionsToCheck: [], next: null, open: null, notices: [], requestsWaiting: 0, checkinsToReview: 0, count: 0, newestAt: null };

describe("PH1: one waiting number (the dot, Waiting for you and the app icon)", () => {
  it("counts the requests waiting, check-ins to review, did-it-happen sessions and notices", () => {
    expect(spotCount({ ...base, requestsWaiting: 2, checkinsToReview: 1, sessionsToCheck: [{} as never], notices: [notice("milestone_celebration")] })).toBe(5);
  });
  it("the requests number is the Requests page's own: the same four kinds, the open organization's groups", () => {
    for (const t of ['from("booking_requests")', 'from("bookings")', 'from("schedule_requests")', "pendingRequestCount(supabase)", "pendingCheckinCount(supabase, groupIds, user.id)"]) expect(route).toContain(t);
    expect(route).toContain('.eq("late_charge_state", "flagged")');
    expect(route).toContain('.in("status", ["pending", "applying"])');
  });
  it("the fold label and the dot read the same count, and the app icon is set from the same answer", () => {
    expect(hub).toContain("`Waiting for you (${needs.count})`");
    expect(hub).toContain("{needs.count > 9 ? \"9+\" : needs.count}");
    expect(hub).toContain("syncAppBadge(badgeCountOf(data));");
    const badge = read("components/coach/app-badge-sync.tsx");
    expect(badge).toContain("await fetchSpotNeeds()");
    expect(badge).not.toContain("/api/requests/waiting-count");
    expect(badgeCountOf({ ...base, count: 4 })).toBe(4);
    expect(badgeCountOf({ ...base, needsChoice: true })).toBeNull();
    expect(badgeCountOf(null)).toBeNull();
  });
});

describe("PH2: one thing counts once", () => {
  it("a message counts by its notice only (unread messages are not added on top)", () => {
    expect(spotCount({ ...base, notices: [notice("direct_message")] })).toBe(1);
    expect(route).not.toContain("unreadMessages");
    expect(route).not.toContain("loadCoachInbox");
  });
  it("a notice about a request or a check-in is not counted again beside it", () => {
    expect(countedNotices([notice("booking_request"), notice("late_change"), notice("schedule_request"), notice("client_request"), notice("weekly_checkin"), notice("direct_message")])).toBe(1);
  });
});

describe("PH3: Requests (n) and Check-ins (n) first in Waiting for you", () => {
  it("only when something waits there, before the notices", () => {
    expect(top).toContain("needs.requestsWaiting > 0 && (");
    expect(top).toContain("needs.checkinsToReview > 0 && (");
    expect(top).toContain("href={REQUESTS_PATH}");
    expect(top).toContain("href={COACH_CHECKINS_PATH}");
    expect(top.indexOf("data-spot-waiting-pages")).toBeLessThan(top.indexOf("needs.notices.length > 0 && ("));
  });
});

describe("PH9, PH10, PH12: Spotlight's Clients is the one client list", () => {
  it("each row: Log their workout (main), then Profile, Message and View as client; the header links Requests and Check-ins", () => {
    const row = panel.slice(panel.indexOf("{filteredClients.map((c) => {"));
    const order = ["Log their workout", "Profile", "Message", "View as client"].map((s) => row.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(panel).toContain("router.push(`/groups/${client.groupId}/messages/${client.id}`);");
    expect(panel).toContain("router.push(REQUESTS_PATH);");
    expect(panel).toContain("router.push(COACH_CHECKINS_PATH);");
    // the Clients page's quick view starts with Log their workout too
    const roster = read("components/coach/mobile/coach-roster-mobile.tsx");
    expect(roster.indexOf("Log their workout")).toBeLessThan(roster.indexOf("/messages/"));
  });
  it("no Start your own workout here (Home does it)", () => {
    expect(panel).not.toContain("Start your own workout");
  });
  it("Groups only when there are groups, + New group folded, no 1-on-1 kind, no inner scroll areas", () => {
    expect(panel).toContain("{hasGroups && (");
    expect(panel).toContain("+ New group");
    expect(panel).toContain("{newGroupOpen && (");
    expect(panel).toContain('export const NEW_GROUP_KINDS: GroupKind[] = ["team", "social"];');
    expect(panel).not.toContain("GROUP_KIND_ORDER");
    expect(panel).not.toMatch(/max-h-\[55vh\]|max-h-40 overflow-y-auto/);
  });
});

describe("PH15, PH16, PH17, PH18: the panels", () => {
  it("tiles by daily use, Ask Spot full width; Program: the main button, then templates, then links", () => {
    expect(hub).toContain('tile.key === "ask-spot" ? "col-span-2 " : ""');
    const program = hub.slice(hub.indexOf('{view === "program" && !needsOrg && ('), hub.indexOf('{view === "ask-spot" && ('));
    expect(program.indexOf("Build a program")).toBeLessThan(program.indexOf("<SpotTemplates"));
    expect(program.indexOf("<SpotTemplates")).toBeLessThan(program.indexOf("All programs"));
  });
  it("Business keeps business: no Support inbox or Organizations", () => {
    expect(hub).not.toContain("Support inbox →");
    expect(hub).not.toContain("Organizations →");
  });
  it("plain words: Monthly plans, not MRR", () => {
    const dash = read("components/coach/desktop/business-mini-dashboard.tsx");
    expect(dash).toContain(">Monthly plans</p>");
    expect(dash).not.toContain(">MRR</p>");
  });
  it("no template section when there are no templates", () => {
    expect(read("components/coach/mobile/spot-templates.tsx")).not.toContain("NO_TEMPLATES_MESSAGE");
  });
});

describe("PH19: New program on the phone opens Spotlight's program box", () => {
  it("for the library, and for the client the page shows", () => {
    expect(phoneNewProgramHref("?library=1")).toBe("/programs?spot=build");
    expect(phoneNewProgramHref("?athleteId=abc")).toBe("/programs?client=abc&spotBuilder=abc");
    expect(hub).toContain("if (spotParam === SPOT_BUILD_PARAM) {");
    expect(hub).toContain('export const SPOT_BUILD_PARAM = "build";');
  });
});

describe("PH22: the Clients page on a phone puts the clients before the coaches", () => {
  it("the Coaches box sits under the client list", () => {
    const page = read("app/(coach)/groups/[groupId]/clients/page.tsx");
    expect(page.indexOf("<CoachesSection ", page.indexOf("<CoachRosterMobile "))).toBeGreaterThan(page.indexOf("<CoachRosterMobile "));
  });
});

describe("PH24: Start <name>'s workout opens the workout when there is exactly one Start", () => {
  it("one Start: that workout; none or two: the Log page (null)", () => {
    expect(soleStartWorkoutId([{ kind: "start", workoutId: "w1" }, { kind: "pick", workoutId: null }])).toBe("w1");
    expect(soleStartWorkoutId([{ kind: "start", workoutId: "w1" }, { kind: "start", workoutId: "w2" }])).toBeNull();
    expect(soleStartWorkoutId([{ kind: "done", workoutId: "w1" }])).toBeNull();
    expect(route).toContain("buildLogChoices(");
    expect(route).toContain("`/groups/${groupId}/athletes/${athleteId}/log/${workoutId}`");
    expect(top).toContain("needs.next.startHref ||");
  });
});
