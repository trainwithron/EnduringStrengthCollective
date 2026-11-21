import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { badgeCountOf, countedNotices, fetchSpotNeeds, soleStartWorkoutId, spotCount, type SpotNeeds } from "./spot-needs";
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
  it("the requests number is ONE function: the Requests page, Spotlight and the Clients pages' Requests link all use it", () => {
    const server = read("lib/requests-center-server.ts");
    const fn = server.slice(server.indexOf("export async function requestsWaitingCount"), server.indexOf("export async function requestsWaitingForSignedIn"));
    for (const t of ['from("booking_requests")', 'from("bookings")', 'from("schedule_requests")', "pendingRequestCount(supabase)", '.eq("late_charge_state", "flagged")', '.in("status", ["pending", "applying"])']) expect(fn).toContain(t);
    expect(server).toContain("requestsWaitingCount(supabase, opts.userId, ids, now),");
    expect(route).toContain("requestsWaitingCount(supabase, user.id, groupIds, now)");
    expect(route).toContain("pendingCheckinCount(supabase, groupIds, user.id)");
    const link = read("components/coach/requests-link.tsx");
    expect(link).toContain("await requestsWaitingForSignedIn(await createServerClient())");
    expect(existsSync(join(__dirname, "..", "app/api/requests/waiting-count/route.ts"))).toBe(false);
  });
  it("a hidden tab never asks; coming back to the front asks once; a read that hangs gives up after 15 seconds", () => {
    const badge = read("components/coach/app-badge-sync.tsx");
    expect(badge).toContain('if (document.visibilityState !== "visible") return;');
    expect(badge).toContain('if (document.visibilityState === "visible") void refresh();');
    expect(read("lib/spot-needs.ts")).toContain("signal: AbortSignal.timeout(SPOT_NEEDS_TIMEOUT_MS)");
  });
  it("an answer inside Waiting for you re-reads the count, and so does closing Spotlight after the fold was open", () => {
    expect(top).toContain("<LateChangesPanel groupIds={needs.groupIds} onChanged={onChanged} />");
    expect(top).toContain("<ScheduleRequestsPanel groupIds={needs.groupIds} onChanged={onChanged} />");
    expect(read("components/coach/late-changes-panel.tsx").match(/onChanged\?\.\(\);/g)?.length).toBe(2);
    expect(read("components/coach/schedule-requests-panel.tsx")).toContain("onChanged?.();");
    const close = hub.slice(hub.indexOf("  function close() {"), hub.indexOf("  function toggle() {"));
    expect(close).toMatch(/if \(needsOpen\) \{[\s\S]*window\.sessionStorage\.removeItem\(SPOT_NEEDS_CACHE_KEY\);[\s\S]*loadNeeds\(true\);/);
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

describe("the shared read", () => {
  it("a full read answers a plain ask in flight; a plain read does not answer a full ask; a failed or timed-out read is null", async () => {
    const urls: string[] = [];
    let fail = false;
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return fail ? Promise.reject(new DOMException("timed out", "TimeoutError")) : Promise.resolve({ ok: true, json: () => Promise.resolve(base) });
    });
    const full = fetchSpotNeeds(true);
    const plain = fetchSpotNeeds();
    expect(await plain).toEqual(base);
    await full;
    expect(urls).toEqual(["/api/coach/spot-needs?full=1"]);
    const plain2 = fetchSpotNeeds();
    const full2 = fetchSpotNeeds(true);
    await Promise.all([plain2, full2]);
    expect(urls.slice(1)).toEqual(["/api/coach/spot-needs", "/api/coach/spot-needs?full=1"]);
    fail = true;
    expect(await fetchSpotNeeds()).toBeNull();
    vi.unstubAllGlobals();
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
  it("Business keeps business: no admin links at all (Settings > Admin holds them)", () => {
    expect(hub).not.toContain("Support inbox →");
    expect(hub).not.toContain("Organizations →");
    expect(hub).not.toContain("Recipe ingredients →");
    expect(hub).not.toContain("is_platform_admin");
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
    // only when Spotlight is opened (?full=1), not for the dot or the icon
    expect(route).toContain('const full = new URL(request.url).searchParams.get("full") === "1";');
    expect(route).toMatch(/full && nextClient && nextClient\.hasProgram/);
    expect(hub).toContain("void fetchSpotNeeds(opening).then(");
    expect(read("components/coach/app-badge-sync.tsx")).toContain("await fetchSpotNeeds()");
    expect(route).toContain("`/groups/${groupId}/athletes/${athleteId}/log/${workoutId}`");
    expect(top).toContain("needs.next.startHref ||");
  });
});
