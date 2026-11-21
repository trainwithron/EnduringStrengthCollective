import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACTION_NOTICE_TYPES, SPOT_NEEDS_CACHE_MS, SPOT_NEEDS_TIMEOUT_MS, badgeCountOf, spotCount, type SpotNeeds } from "./spot-needs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

// Clutter round 2, part C (Ron, Nov 21: "Go with the fix for PH14 ... And go with the fix for PH11"): the coach's phone Spotlight.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const lib = read("lib/spot-needs.ts");
const route = read("app/api/coach/spot-needs/route.ts");
const top = read("components/coach/mobile/spot-needs-top.tsx");
const hub = read("components/coach/mobile/coach-spot-hub.tsx");
const badge = read("components/coach/app-badge-sync.tsx");
const panel = read("components/coach/mobile/spot-clients-groups-panel.tsx");
const button = read("components/coach/view-as-client-button.tsx");
const profile = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");

const base: SpotNeeds = { needsChoice: false, groupIds: ["g"], timezone: "UTC", sessionsToCheck: [], next: null, open: null, requestsWaiting: 0, checkinsToReview: 0, count: 0, newestAt: null };

describe("PH14: notices live only in the bell", () => {
  it("the count is only what Waiting for you lists to act on: requests, check-ins and did-it-happen sessions", () => {
    expect(spotCount({ ...base, requestsWaiting: 2, checkinsToReview: 1, sessionsToCheck: [{} as never, {} as never] })).toBe(5);
    // an old answer that still carries notices counts the same (they are never added)
    expect(spotCount({ ...base, notices: [{ type: "milestone_celebration" }, { type: "direct_message" }] } as never)).toBe(0);
    expect(lib).not.toContain("notices: SpotNotice[]");
    expect(lib).not.toContain("countedNotices");
  });
  it("Waiting for you lists no notices and has no Mark all read of its own", () => {
    expect(top).not.toContain("needs.notices");
    expect(top).not.toContain("markAllRead");
    expect(top).not.toContain("data-spot-mark-all");
    expect(top).not.toContain('from("notifications")');
    expect(hub).not.toContain("onNoticesCleared");
    expect(hub).toMatch(/<SpotNeedsTop\s+needs=\{needs\}\s+onNavigated=\{close\}\s+onChanged=\{\(\) => loadNeeds\(true\)\}\s+\/>/);
  });
  it("the bell beside Spotlight stays, with its own unread count and Mark all read", () => {
    expect(hub).toContain("<NotificationBell viewerId={profileId} scopeGroupId={null} />");
    const bell = read("components/athlete/notification-bell.tsx");
    expect(bell).toContain("const unreadCount = items.filter((n) => !n.readAt).length;");
    expect(bell).toContain("Mark all read");
  });
  it("the route reads no notices to list: only the time of the newest unread one about a request or a check-in, for the fade", () => {
    expect(route).not.toContain("noticeHref(");
    expect(route).not.toContain("notices,");
    expect(route).toContain('.select("created_at")');
    expect(route).toContain('.in("type", [...ACTION_NOTICE_TYPES])');
    expect(route).toContain(".limit(1),");
    expect(route).toContain("newestAt: newestOf([newestNoticeAt, ...sessionsToCheck.map((s) => s.startIso)]),");
    expect([...ACTION_NOTICE_TYPES].sort()).toEqual(["booking_request", "client_request", "late_change", "schedule_request", "weekly_checkin"]);
  });
  it("the app icon shows the same number as the dot and the fold: action items only", () => {
    expect(badgeCountOf({ ...base, count: 3 })).toBe(3);
    expect(badgeCountOf({ ...base, needsChoice: true, count: 3 })).toBeNull();
    expect(hub).toContain("`Waiting for you (${needs.count})`");
    expect(hub).toContain('{needs.count > 9 ? "9+" : needs.count}');
    expect(hub).toContain("syncAppBadge(badgeCountOf(data));");
    expect(badge).toContain("applyAppBadge(nav, badgeCountOf(data));");
  });
  it("round 1's read stays as it was: a minute's memory, one read shared, 15 seconds, ?full=1 and never from a hidden tab", () => {
    expect(SPOT_NEEDS_CACHE_MS).toBe(60_000);
    expect(SPOT_NEEDS_TIMEOUT_MS).toBe(15_000);
    expect(lib).toContain("if (inflight && (inflight.full || !full)) return inflight.request;");
    expect(lib).toContain('fetch(full ? "/api/coach/spot-needs?full=1" : "/api/coach/spot-needs"');
    expect(route).toContain('const full = new URL(request.url).searchParams.get("full") === "1";');
    expect(badge).toContain('if (document.visibilityState !== "visible") return;');
    expect(badge).toContain('if (document.visibilityState === "visible") void refresh();');
  });
});

describe("PH11: View as client lives once, on the client's Profile page", () => {
  it("the Spotlight client rows keep Log their workout, Profile and Message, and no View as client", () => {
    const row = panel.slice(panel.indexOf("{filteredClients.map((c) => {"), panel.indexOf("{onlineCount > 0 && ("));
    for (const label of ["Log their workout", "Profile", "Message"]) expect(row).toContain(label);
    expect(row).not.toContain("View as client");
    expect(panel).not.toContain("/api/coach/act-as");
    expect(panel).not.toContain("pendingClient");
  });
  it("the button asks first, with the words the row used, then starts the view", async () => {
    const { ViewAsClientButton } = await import("@/components/coach/view-as-client-button");
    const html = renderToStaticMarkup(createElement(ViewAsClientButton, { athleteId: "a1", groupId: "g1", name: "Jane" }));
    expect(html).toContain("View as client");
    expect(html).toContain("min-h-11");
    expect(button).toContain("<p className=\"font-body text-sm text-chalk mb-1\">View as {name}?</p>");
    expect(button).toContain("You&apos;ll see their real data, and anything you log from here on is attributed to them — until you exit this view.");
    expect(button).toContain('await fetch("/api/coach/act-as", { method: "POST"');
    expect(button).toContain("body: JSON.stringify({ athleteId, groupId })");
    expect(button).toContain("router.push(`/groups/${groupId}`);");
    expect(button.match(/min-h-11/g)?.length).toBe(3);
  });
  it("on the profile once, for a coach looking at a client (never their own profile), on the phone only (the computer has no act-as)", () => {
    expect(profile.match(/<ViewAsClientButton /g)?.length).toBe(1);
    const block = profile.slice(profile.lastIndexOf("{!selfView && (", profile.indexOf("<ViewAsClientButton ")), profile.indexOf("<ViewAsClientButton "));
    expect(block).toContain("<VideoCheckinRecorder");
    expect(block).toContain('<span className="lg:hidden contents">');
    // the computer keeps its read-only preview in the Program tab
    expect(profile).toContain('<span className="hidden lg:inline-flex">\n                        <ViewAsClientLink');
  });
});

describe("accent text", () => {
  it("uses text-rust-ink, never plain text-rust, in the files this part changed", () => {
    for (const src of [top, button, panel]) expect(src).not.toMatch(/text-rust(?![-\w])/);
  });
});
