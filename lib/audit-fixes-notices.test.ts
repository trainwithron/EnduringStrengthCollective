import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { noticeHref, pushHrefForNotice, LEAVING_PATH, NOTIFICATIONS_PATH } from "@/lib/notice-links";
import { phoneCoachRedirect } from "@/lib/phone-coach-routes";
import { sessionLinks } from "@/components/coach/session-menu";

// Ron, Nov 21 ("yes fix all of them"): the buttons, notices and pushes that scrolled, mislinked or dead-ended. Notices, pushes, phone redirects and the calendar.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const G = "11111111-1111-4111-8111-111111111111";
const N = "22222222-2222-4222-8222-222222222222";

describe("P1 to P9: what a notice or push opens is shown on the phone", () => {
  it("running low, recurring conflicts, Business, leads, support, Message all, a client's history, Team and Plan & Billing open on a phone", () => {
    for (const [path, q] of [
      ["/running-low", ""],
      ["/recurring-conflicts", ""],
      [`/groups/${G}/business`, ""],
      [`/groups/${G}/business/leads`, ""],
      [`/groups/${G}/business/support`, ""],
      [`/groups/${G}/messages/announce`, ""],
      [`/groups/${G}/athletes/${N}/history`, ""],
      [`/groups/${G}/branding`, "?tab=team"],
      [`/groups/${G}/branding`, "?tab=credits"],
      [`/groups/${G}/branding`, "?tab=billing"],
    ] as const) {
      expect(phoneCoachRedirect(path, q), `${path}${q}`).toBeNull();
    }
  });
  it("the organization page keeps its tab when it moves a one-on-one space to its anchor (Plan & Billing lands on Plan & Billing)", () => {
    expect(read("app/(coach)/groups/[groupId]/branding/page.tsx")).toContain("searchParams.tab ? `branding?tab=${encodeURIComponent(searchParams.tab)}` : \"branding\"");
  });
  it("a problem with the coach's own plan opens Plan & Billing, a support reply with no group opens Support, both found on open", () => {
    expect(noticeHref("payment_problem", "/dashboard", { id: N })).toBe(`/notice/${N}`);
    expect(noticeHref("support_reply", "/dashboard", { id: N })).toBe(`/notice/${N}`);
    const route = read("app/notice/[id]/route.ts");
    expect(route).toContain("`/groups/${active.anchor.id}/business/support`");
    expect(route).toContain("`/groups/${active.anchor.id}/branding?tab=billing`");
    // the AI budget push opens Plan & Billing too, and an organization announcement the notifications list
    expect(read("lib/ai-budget-server.ts")).toContain("`/groups/${groupId}/branding?tab=billing`");
    expect(read("app/api/org/announce/route.ts")).toContain('.slice(0, 140), "/notifications")');
  });
});

describe("P16 and D14: notices that opened Home open their own page", () => {
  it("a leaving coach's notices open their steps, on any screen", () => {
    expect(noticeHref("coach_departure_reminder", "/dashboard")).toBe(LEAVING_PATH);
    expect(phoneCoachRedirect(LEAVING_PATH)).toBeNull();
    const notify = read("lib/leaving-coach-notify.ts");
    expect(notify).not.toContain('linkPath: "/dashboard"');
    expect(read("app/(coach)/leaving/page.tsx")).toContain("<LeavingCoachBanner departures={withExport}");
  });
  it("a dispatch notice to the organization's admins opens the message itself (there is no admin page for a request), a trainer's opens the request", () => {
    expect(noticeHref("trainer_dispatch_offer", "/dashboard")).toBe(NOTIFICATIONS_PATH);
    expect(noticeHref("trainer_dispatch_question", "/dashboard")).toBe(NOTIFICATIONS_PATH);
    expect(noticeHref("trainer_dispatch_offer", "/dispatch/s1")).toBe("/dispatch/s1");
  });
  it("Home's organization notices open where every notice opens", () => {
    expect(read("components/coach/desktop/org-notifications-panel.tsx")).toContain("href={noticeHref(n.type, n.linkPath, { id: n.id })}");
  });
});

describe("P25: a tapped push marks its notice read", () => {
  it("a pushed notice opens through /notice/<id>, which marks it read before it opens", () => {
    expect(pushHrefForNotice(N, "/x")).toBe(`/notice/${N}`);
    expect(pushHrefForNotice(null, "/x")).toBe("/x");
    expect(read("app/notice/[id]/route.ts")).toContain('.update({ read_at: new Date().toISOString() }).eq("id", notice.id).eq("profile_id", user.id).is("read_at", null)');
    expect(read("app/api/cron/notification-push/route.ts")).toContain("pushHrefForNotice(n.id, noticeHref(");
    for (const f of ["lib/payment-events.ts", "lib/notify-payment.ts", "lib/trainer-dispatch-advance.ts", "lib/leaving-coach-notify.ts"]) expect(read(f), f).toContain("pushHrefForNotice(");
  });
  it("answering a request from the notification marks its notice read too", () => {
    expect(read("public/sw.js")).toContain('await fetch(url, { credentials: "include", redirect: "manual" })');
  });
});

describe("P12 to P14: the calendar's day", () => {
  it("a tap on a booked session opens its menu, with Open profile and Log their workout", () => {
    expect(sessionLinks({ athleteId: N, groupId: G })).toEqual({ profile: `/groups/${G}/athletes/${N}`, log: `/groups/${G}/athletes/${N}/log` });
    expect(sessionLinks({ athleteId: null, groupId: G })).toBeNull();
    const menu = read("components/coach/session-menu.tsx");
    expect(menu).toContain("Open profile");
    expect(menu).toContain("Log their workout");
    expect(menu).toContain("onClick={menu.tapOpens(session)}");
    const page = read("app/(coach)/groups/[groupId]/calendar/[date]/page.tsx");
    expect(page).toContain("openOnTap");
    expect(page).toContain("athleteId: booking.athlete_id ?? null, groupId: booking.group_id ?? params.groupId");
    expect(read("components/coach/desktop/day-hour-grid.tsx")).toContain("onClick={sessionMenu.tapOpens(session)}");
  });
  it("an Open time opens the day's Add sheet at that time", () => {
    expect(read("app/(coach)/groups/[groupId]/calendar/[date]/page.tsx")).toContain("<AddAtTimeButton time={hhmmInZone(start, timezone)}");
    expect(read("components/coach/add-at-time-button.tsx")).toContain("new CustomEvent(DAY_ADD_AT_EVENT, { detail: { time } })");
    expect(read("components/coach/desktop/day-calendar.tsx")).toContain("window.addEventListener(DAY_ADD_AT_EVENT, onAddAt);");
  });
  it("each Upcoming row on the phone Calendar opens its day", () => {
    expect(read("components/coach/upcoming-sessions-list.tsx")).toContain("<Link key={r.id} href={r.href}");
    expect(read("components/coach/mobile/coach-phone-schedule.tsx")).toContain("href: `/groups/${anchorGroupId}/calendar/${dateKeyInZone(timezone, new Date(b.startAt))}`");
  });
});

describe("P15, P23, D10", () => {
  it("a client's every-week swap notice opens the builder on a phone, where the swap and Undo are", () => {
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).toContain("if (!searchParams.edit && !searchParams.swap && (await prefersAthleteStyleView())) {");
  });
  it("Spotlight's deep links are checked again whenever the address changes", () => {
    const hub = read("components/coach/mobile/coach-spot-hub.tsx");
    expect(hub).toContain("}, [pathname, spotParam, hash]);");
    expect(hub).toContain('window.addEventListener("hashchange", read);');
  });
  it("Needs you's Review opens that client's check-in first and shows it", () => {
    expect(read("lib/needs-you-data.ts")).toContain("href: `${COACH_CHECKINS_PATH}?focus=${c.id}`");
    const list = read("components/coach/checkin-review-list.tsx");
    expect(list).toContain("useState<string | null>(focusHere ?? initialItems[0]?.id ?? null)");
    expect(list).toContain("id={`checkin-${item.id}`}");
  });
});

describe("review fixes (Code Chat, Nov 21)", () => {
  it("A: a prefetch request does not mark read; links through /notice/ are never prefetched", async () => {
    const { isPrefetch, noticeLinkPrefetch } = await import("@/lib/notice-links");
    const req = (h: Record<string, string>) => ({ headers: new Headers(h) });
    expect(isPrefetch(req({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isPrefetch(req({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetch(req({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
    expect(isPrefetch(req({}))).toBe(false);
    expect(read("app/notice/[id]/route.ts")).toContain("if (!isPrefetch(request)) await supabase.from(\"notifications\").update({ read_at:");
    expect(noticeLinkPrefetch(`/notice/${N}`)).toBe(false);
    expect(noticeLinkPrefetch("/requests")).toBeUndefined();
    for (const f of ["components/athlete/notification-bell.tsx", "components/notifications/notification-list.tsx", "components/coach/mobile/spot-needs-top.tsx"]) expect(read(f), f).toContain("prefetch={noticeLinkPrefetch(");
    expect(read("components/coach/desktop/org-notifications-panel.tsx")).toContain("<Link prefetch={false}");
  });
  it("B: an AI budget push opens Plan & Billing in a group the recipient coaches in that organization, else Home", async () => {
    const { budgetHrefFor } = await import("@/lib/ai-budget-server");
    const db = (rows: unknown[] | null, fail = false) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        limit: async () => (fail ? Promise.reject(new Error("down")) : { data: rows, error: null }),
      };
      return { from: () => q } as any;
    };
    expect(await budgetHrefFor(db([{ group_id: "g1" }]), "coach1", "org1")).toBe("/groups/g1/branding?tab=billing");
    expect(await budgetHrefFor(db([]), "coach1", "org1")).toBe("/dashboard");
    expect(await budgetHrefFor(db(null, true), "coach1", "org1")).toBe("/dashboard");
    const src = read("lib/ai-budget-server.ts");
    expect(src).toContain('.select("group_id, groups!inner ( organization_id )")');
    expect(src).toContain('.eq("role", "coach")');
    expect(src).toContain('.eq("groups.organization_id", orgId)');
  });
});

describe("drafted notes never ride in the address (Commander, Nov 21)", () => {
  it("the calendar spotter's Send a note opens the drafted note through a key, not its words", () => {
    const panel = read("components/coach/desktop/calendar-spotter-panel.tsx");
    expect(panel).toContain("<DraftMessageLink");
    expect(panel).not.toContain("?draft=${encodeURIComponent(");
  });
});
