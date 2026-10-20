import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newestOf, shouldFade, spotCount } from "./spot-needs";
import { TEAM_SPORT_HIDDEN_HUB_TILES } from "./team-sport";

// Phone opens as the coach's own account, Release 1 (additive). Ron, Oct 19-20: "I already have a calendar button. That doesn't need to be there. Quick payment could probably be rolled into
// business." "I do want messages in the spotlight tab." "that could be our notification bell ... just like a dull fading in and out. Or a dot."
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const hub = read("components/coach/mobile/coach-spot-hub.tsx");

describe("Spotlight tiles", () => {
  it("Clients, Messages, Business, Program, Ask Spot: no Calendar tile and no Quick payment tile", () => {
    const tiles = hub.slice(hub.indexOf("export const TILES"), hub.indexOf("];", hub.indexOf("export const TILES")));
    expect([...tiles.matchAll(/key: "([a-z-]+)"/g)].map((m) => m[1])).toEqual(["clients", "messages", "business", "program", "ask-spot"]);
    expect(hub).not.toContain("CalendarMiniView");
    expect(hub).not.toContain('view === "quick-payment"');
  });
  it("a team-sport group hides Business (Quick payment is inside it)", () => {
    expect(TEAM_SPORT_HIDDEN_HUB_TILES).toEqual(["business"]);
  });
  it("Business shows the business numbers, then Quick payment under them; no dead-end Go deeper", () => {
    const business = hub.slice(hub.indexOf('{view === "business" && !needsOrg && ('), hub.indexOf('{view === "program" && !needsOrg && ('));
    expect(business.indexOf("<BusinessMiniDashboard")).toBeLessThan(business.indexOf("<QuickPaymentPanel"));
    expect(read("components/coach/desktop/business-mini-dashboard.tsx")).not.toContain("Go deeper");
  });
  it("Messages lists every conversation and opens it", () => {
    expect(hub).toContain("<SpotMessagesPanel key={activeGroupId} groupId={activeGroupId} onNavigated={close} />");
    const panel = read("components/coach/mobile/spot-messages-panel.tsx");
    expect(panel).toContain("fetch(`/api/messages/inbox?groupId=${encodeURIComponent(groupId)}`)");
    expect(panel).toContain("href={`/groups/${c.groupId}/messages/${c.otherId}`}");
    expect(panel).toContain("c.unreadCount > 0");
  });
  it("a group row opens that group's people, not the old dashboard", () => {
    const panel = read("components/coach/mobile/spot-clients-groups-panel.tsx");
    expect(panel).toContain("router.push(`/groups/${targetGroupId}/clients`);");
  });
  it("the tiles that need an organization ask for one", () => {
    expect(hub).toContain('{needsOrg && ["clients", "messages", "business", "program"].includes(view) && (');
  });
});

describe("what needs the coach is at the top of the drop-down", () => {
  const top = read("components/coach/mobile/spot-needs-top.tsx");
  it("notices, did-it-happen cards, Resume / Start the next client's workout, then Home's panels", () => {
    const order = ["needs.notices.length > 0", "<SessionCheckCards", "Resume {needs.open.name}", "Start {needs.next.name}", "<LateChangesPanel", "<ScheduleRequestsPanel", "<ExpiryCheckInPanel", "<InactiveClientsPanel", "<ProgressLookPanel"];
    const at = order.map((s) => top.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("the same places Home's buttons open", () => {
    expect(top).toContain("href={`/sessions/${needs.open.sessionId}?resume=1`}");
    expect(top).toContain("`/groups/${needs.next.groupId}/athletes/${needs.next.athleteId}/log`");
  });
  it("read when the page opens and every time Spotlight opens", () => {
    expect(hub).toContain("loadNeeds(false);");
    expect(hub).toContain("loadNeeds(true);");
    expect(hub).toContain("{needs && !needs.needsChoice && <SpotNeedsTop needs={needs} onNavigated={close} />}");
  });
  it("the route works for the organization the coach is in, and asks nothing when it must be chosen", () => {
    const route = read("app/api/coach/spot-needs/route.ts");
    expect(route).toContain("const active = await getActiveAnchor(supabase, user.id);");
    expect(route).toContain("if (active.needsChoice) return NextResponse.json({ ...empty, needsChoice: true });");
    expect(route).toContain("const groupIds = groupsInOrgOf(active.groups, active.anchor.id).map((g) => g.id);");
    expect(route).toContain("loadSessionsToCheck(supabase, user.id, groupIds)");
    expect(route).toContain(".is(\"read_at\", null)");
  });
});

describe("the dot and the gentle fade", () => {
  it("counts sessions to check, unread notices and unread messages", () => {
    expect(spotCount({ sessionsToCheck: [{} as never, {} as never], notices: [{} as never], unreadMessages: 3 })).toBe(6);
    expect(spotCount({ sessionsToCheck: [], notices: [], unreadMessages: 0 })).toBe(0);
  });
  it("fades only for something newer than the last open, never with reduced motion", () => {
    expect(newestOf(["2026-10-20T01:00:00Z", null, "2026-10-20T03:00:00Z"])).toBe("2026-10-20T03:00:00Z");
    expect(shouldFade("2026-10-20T03:00:00Z", "2026-10-20T02:00:00Z", false)).toBe(true);
    expect(shouldFade("2026-10-20T01:00:00Z", "2026-10-20T02:00:00Z", false)).toBe(false);
    expect(shouldFade("2026-10-20T03:00:00Z", null, false)).toBe(true);
    expect(shouldFade("2026-10-20T03:00:00Z", null, true)).toBe(false);
    expect(shouldFade(null, null, false)).toBe(false);
  });
  it("twice, gently (2 s each), then a dot; off with reduced motion; opening Spotlight stops it", () => {
    const css = read("app/globals.css");
    expect(css).toContain("animation: spot-dot-fade 2s ease-in-out 2;");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \.spot-dot-fade \{\n    animation: none;/);
    expect(hub).toContain('className={`absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rust');
    const toggle = hub.slice(hub.indexOf("  function toggle() {"), hub.indexOf("  useEffect(() => {\n    if (!open) return;"));
    expect(toggle).toContain("setFade(false);");
    expect(toggle).toContain("window.localStorage.setItem(SPOT_LAST_OPENED_KEY, new Date().toISOString());");
  });
});

describe("Quick payment and the AI builder see every client (one-on-one clients included)", () => {
  it("Quick payment lists the organization's clients and charges in each client's own group", () => {
    const qp = read("components/coach/mobile/quick-payment-panel.tsx");
    expect(qp).toContain("const clients = await getCoachClients(supabase, user.id, groupId);");
    expect(qp).toContain("body: JSON.stringify({ groupId: selected.groupId, athleteId: selected.profileId, amountCents, description })");
    expect(qp).not.toContain('.from("group_memberships")');
  });
  it("the AI builder lists them too and makes the program in the client's own group", () => {
    const b = read("components/coach/mobile/spot-builder-panel.tsx");
    expect(b).toContain("const list = await getCoachClients(supabase, user.id, groupId);");
    expect(b).toContain("groupId={athleteGroupId ?? groupId}");
    expect(b.match(/setAthleteGroupId\(c\?\.groupId \?\? null\);/g)?.length).toBe(2);
  });
});
