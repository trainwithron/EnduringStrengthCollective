// The coach desktop audit (Nov 21): buttons that scrolled instead of opening, opened the wrong page, or dead-ended. One test per item, by its audit number.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pickNeedsYou, type NeedsYouItem, type NeedsYouKind } from "@/lib/needs-you";
import { loadNeedsYouItems } from "@/lib/needs-you-data";
import { NAV_DESTINATIONS, notOnPhone, resolveNavigation, type NavContext } from "@/lib/nav-intents";
import { HOWTOS } from "@/lib/howto-library";
import { requestsFromAnswers } from "@/lib/meal-plan-rebuild";
import { hashNames } from "@/components/shared/scroll-to-hash";
import { NeedsYouStrip } from "@/components/coach/desktop/needs-you-strip";
import { YourDayPanel } from "@/components/coach/desktop/your-day-panel";
import { TrainedThisWeekRing } from "@/components/coach/desktop/trained-this-week-ring";
import { AVAILABILITY_HREF, PUBLIC_PAGE_ANCHOR } from "@/lib/my-page-qr";
import { PULSE_ATTENTION_HREF } from "@/lib/home-greeting";
import { failedCardDraft } from "@/components/coach/payment-problems-section";
import type { AttentionItem } from "@/lib/your-day";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const PROFILE = "app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx";

function fakeDb(rows: Record<string, unknown[]>) {
  const chain = (table: string) => {
    const self: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [], error: null });
        if (prop === "maybeSingle") return () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null });
        return () => self;
      },
    });
    return self;
  };
  return { from: (t: string) => chain(t), rpc: () => Promise.resolve({ data: [], error: null }) } as never;
}
const base = {
  coachId: "coach",
  timezone: "America/Los_Angeles",
  now: new Date("2026-10-08T15:00:00Z"),
  groupIds: ["g1"],
  todayBookings: [],
  needsPayment: [],
  lowReadiness: [],
  quietTierByAthlete: new Map() as never,
  needsReplyThreads: [],
};
const item = (id: string, kind: NeedsYouKind, extra: Partial<NeedsYouItem> = {}): NeedsYouItem => ({ id, kind, name: `N ${id}`, sentence: "x.", button: "Open", href: `/x/${id}`, order: 0, ...extra });

describe("Needs you on Home", () => {
  it("D1: a client who has not signed in gets Send link on the card (the profile's send and confirm) and Sign-in options on their profile's section", async () => {
    const { items } = await loadNeedsYouItems(
      fakeDb({ group_memberships: [{ group_id: "g1", profile_id: "a1" }], profiles: [{ id: "a1", full_name: "Jeff Ziegler", claimed_at: null }] }),
      { ...base, quietTierByAthlete: new Map([["a1", "strong"]]) as never }
    );
    const jeff = items.find((i) => i.kind === "not_signed_in")!;
    expect(jeff.href).toBe("/groups/g1/athletes/a1?tab=settings#sign-in-options");
    expect(jeff.claimLink).toEqual({ athleteId: "a1", groupId: "g1" });
    expect(jeff.profileHref).toBe("/groups/g1/athletes/a1");
    const strip = read("components/coach/desktop/needs-you-strip.tsx");
    expect(strip).toContain("<NeedsYouSendLink groupId={item!.claimLink.groupId}");
    const more = read("components/coach/desktop/needs-you-more.tsx");
    expect(more).toContain("<EmailClaimLinkButton");
    // the same send (and its "a new link replaces the old one" confirm) as the profile's button
    expect(read("components/coach/email-claim-link-button.tsx")).toContain('fetch("/api/clients/email-claim-link"');
    expect(read("components/coach/email-claim-link-button.tsx")).toContain("Email a new sign-in link? The old one stops working.");
    // and the profile scrolls to the section the link names, once its tab shows
    expect(read(PROFILE)).toContain("<ScrollToHash ids={[SIGN_IN_OPTIONS_ANCHOR, ADD_SESSIONS_ANCHOR, GOAL_SHEET_ANCHOR, PAYMENT_HOLD_ANCHOR]} />");
  });

  it("D4: sessions about to expire open their conversation with the expiry panel's drafted check-in", async () => {
    const { items } = await loadNeedsYouItems(
      fakeDb({
        coach_booking_policies: [{ credit_expiry_days: 30, expiry_heads_up_days: 14 }],
        session_credits: [{ athlete_id: "a1", group_id: "g1", balance: 4, last_granted_at: "2026-09-12T15:00:00Z", expiry_hold_until: null }],
        group_memberships: [{ group_id: "g1", profile_id: "a1" }],
        profiles: [{ id: "a1", full_name: "Sam Lee", claimed_at: "x" }],
      }),
      base
    );
    const e = items.find((i) => i.kind === "expiring_credits")!;
    expect(e).toBeDefined();
    expect(e.button).toBe("Message Sam");
    expect(e.href.startsWith("/groups/g1/messages/a1?draft=")).toBe(true);
    expect(decodeURIComponent(e.href.split("draft=")[1])).toContain("Hi Sam, I noticed you have 4 sessions left");
    expect(e.href).not.toContain("#expiring");
  });

  it("D20: a quiet client's Check in opens the conversation with a check-in drafted", async () => {
    const { items } = await loadNeedsYouItems(
      fakeDb({ group_memberships: [{ group_id: "g1", profile_id: "a1" }], profiles: [{ id: "a1", full_name: "Ann Bell", claimed_at: "x" }] }),
      { ...base, quietTierByAthlete: new Map([["a1", "strong"]]) as never }
    );
    const q = items.find((i) => i.kind === "quiet_strong")!;
    expect(q.href.startsWith("/groups/g1/messages/a1?draft=")).toBe(true);
    expect(decodeURIComponent(q.href.split("draft=")[1])).toMatch(/^Hey Ann, haven't seen you in a bit/);
    expect(q.profileHref).toBe("/groups/g1/athletes/a1");
  });

  it("D26: a goal due for its 90-day talk opens the profile on the goal sheet, which has the anchor and scrolls to it", async () => {
    const { items } = await loadNeedsYouItems(
      fakeDb({
        client_goal_sheets: [{ athlete_id: "a2", group_id: "g1", filled_at: "2026-05-01T00:00:00Z", reviewed_at: null }],
        group_memberships: [{ group_id: "g1", profile_id: "a2" }],
        profiles: [{ id: "a2", full_name: "Bo", claimed_at: "x" }],
      }),
      base
    );
    expect(items.find((i) => i.kind === "goal_review")).toMatchObject({ href: "/groups/g1/athletes/a2#goal-sheet", profileHref: "/groups/g1/athletes/a2" });
    expect(read(PROFILE)).toMatch(/<div id=\{GOAL_SHEET_ANCHOR\} className="scroll-mt-24">\s*<GoalSheetSection/);
  });

  it("D5: 'N more' opens the rest of the ranked list in place, every item with its own button, and closes again", () => {
    const kinds: NeedsYouKind[] = ["schedule_request", "client_message", "checkin_review", "session_soon", "goal_review", "injury", "low_readiness", "load_fatigue", "missed_habits", "not_signed_in"];
    const view = pickNeedsYou(kinds.map((k, i) => item(`i${i}`, k, k === "not_signed_in" ? { claimLink: { athleteId: "a", groupId: "g" } } : {})));
    expect(view.moreCount).toBe(7);
    expect(view.more.map((i) => i.kind)).toEqual(["client_message", "checkin_review", "goal_review", "low_readiness", "load_fatigue", "missed_habits", "not_signed_in"]);
    // nothing shown on a card is in the list, and the list is in rank order
    for (const s of view.slots) expect(view.more.some((m) => m.id === s.item?.id)).toBe(false);
    const html = renderToStaticMarkup(createElement(NeedsYouStrip, { view }));
    expect(html).toContain("7 more");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('href="#needs-stack"');
    const more = read("components/coach/desktop/needs-you-more.tsx");
    expect(more).toContain("{open ? FEWER_LABEL : moreLabel(items.length)}");
    expect(more).toContain("<ItemAction item={item} viewer={viewer} />");
  });
});

describe("Home", () => {
  it("D2: Get started's Add a client opens Add client", () => {
    expect(read("components/coach/desktop/getting-started-card.tsx")).toMatch(/href: "\/clients\?add=1",\s*cta: "Add a client"/);
  });
  it("D17: '{N} could use a check-in' and the Need attention / At-risk counts open the Pulse attention list", () => {
    const html = renderToStaticMarkup(createElement(TrainedThisWeekRing, { active: 3, total: 10, needCheckIn: 4 }));
    expect(html).toContain(`href="${PULSE_ATTENTION_HREF}"`);
    expect(html).toContain("4 could use a check-in");
    expect(renderToStaticMarkup(createElement(TrainedThisWeekRing, { active: 3, total: 10, needCheckIn: 0 }))).not.toContain("href=");
    const data = read("lib/dashboard-data.ts");
    expect(data).toContain('label: "At-risk clients", display: String(needsAttentionCount), href: PULSE_ATTENTION_HREF');
    expect(data).toContain('label: "Need attention", display: String(needsAttentionCount), href: PULSE_ATTENTION_HREF');
    expect(read("components/coach/desktop/dashboard-stat-tiles.tsx")).toContain("<a href={current.href}");
    const pulse = read("components/coach/desktop/pulse-tabs.tsx");
    expect(pulse).toContain("id={PULSE_ATTENTION_ANCHOR}");
    // opened, not just scrolled to, on load, on a change of address, and on a click of a link to it
    expect(pulse).toMatch(/const openList = \(\) => \{\s*setTab\("clients"\);\s*setAttentionOpen\(true\);/);
    expect(pulse).toContain('window.addEventListener("hashchange", onHash);');
    expect(pulse).toContain('document.addEventListener("click", onClick);');
  });
  it("D19: Clear new-activity dots says Done or the problem, and is ready again afterwards", () => {
    const b = read("components/coach/desktop/mark-all-seen-button.tsx");
    expect(b).toContain('export const CLEAR_DOTS_LABEL = "Clear new-activity dots";');
    expect(b).not.toContain(': "Mark all as seen"');
    expect(b).toContain('{state === "busy" ? "Clearing…" : CLEAR_DOTS_LABEL}');
    expect(b).toContain('setState("done")');
    expect(b).toContain('if (error) {\n        setState("failed");');
    expect(b).toContain('setTimeout(() => setState("idle"), 3000)');
    expect(b).toContain("Couldn&apos;t clear them.");
  });
  it("D21: Your day's list shows six and a button opens the rest", () => {
    const attention: AttentionItem[] = Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, kind: "reply", text: `Reply ${i}`, href: `/r/${i}`, urgency: 1 }) as AttentionItem);
    const html = renderToStaticMarkup(createElement(YourDayPanel, { schedule: [], attention, timezone: "America/Los_Angeles" }));
    expect(html).toContain("Show 3 more");
    expect(html).not.toContain("more below");
    expect((html.match(/href="\/r\//g) ?? []).length).toBe(6);
  });
});

describe("client pages", () => {
  it("D3: Start {name}'s workout always opens the log, program or not", () => {
    const s = read("components/coach/next-client-workout-section.tsx");
    expect(s).toContain("const href = `/groups/${next.groupId}/athletes/${next.athleteId}/log`;");
  });
  it("D11/P21: the log page with no program sends Assign a program to the Program tab", () => {
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/log/page.tsx")).toMatch(/href=\{`\/groups\/\$\{params\.groupId\}\/athletes\/\$\{params\.athleteId\}\?tab=program`\}[\s\S]{0,200}Assign a program/);
  });
  it("D22: Overview's Sign-in options opens the section itself", () => {
    expect(read(PROFILE)).toContain("?tab=settings#${SIGN_IN_OPTIONS_ANCHOR}`} className=\"text-rust-ink underline underline-offset-2\">\n                Sign-in options");
  });
  it("D23: the group members grid's sign-in pill opens the sign-in section", () => {
    expect(read("components/coach/desktop/client-card-grid.tsx")).toContain("href={`/groups/${groupId}/athletes/${member.profileId}?tab=settings#${SIGN_IN_OPTIONS_ANCHOR}`}");
  });
  it("D6: a hold comes off from the Clients menu and from Billing, with the same call, and Needs payment says where", () => {
    const control = read("components/coach/payment-hold-control.tsx");
    expect(control).toContain("setPaymentHold(groupId, athleteId, false)");
    expect(control).toContain('.select("payment_hold")');
    expect(read("lib/payment-hold-client.ts")).toContain('fetch("/api/reup/hold"');
    expect(read("lib/payment-hold-client.ts")).toContain("the Clients page, or in Billing on their profile");
    expect(read("components/coach/desktop/needs-payment-panel.tsx")).not.toContain("You can take a hold off from the Clients page.`");
  });
  it("D9: Progress look no longer names a Programming tab; it opens the Program tab with the way to make their own copy", () => {
    const p = read("components/coach/progress-look-panel.tsx");
    expect(p).not.toContain("Programming on their profile");
    expect(p).toContain("/athletes/${card.athleteId}?tab=program`}");
    expect(p).toContain("and use Assign program to give them their own copy");
  });
  it("D8: Rebuild with their requests builds the plan with them (an event the builder listens for), not a jump", () => {
    expect(requestsFromAnswers([
      { requestsText: " steak ", status: "new" },
      { requestsText: "Steak", status: "new" },
      { requestsText: "", status: "new" },
      { requestsText: "pizza", status: "handled" },
      { requestsText: "sweet  potato", status: "new" },
    ])).toBe("steak, sweet potato");
    const panel = read("components/coach/nutrition/client-answers-panel.tsx");
    expect(panel).toContain("window.dispatchEvent(new CustomEvent<RebuildWithRequests>(REBUILD_WITH_REQUESTS_EVENT, { detail }));");
    expect(panel).not.toContain('<a href="#meal-plan"');
    const gen = read("components/coach/desktop/meal-plan-generator.tsx");
    expect(gen).toContain("window.addEventListener(REBUILD_WITH_REQUESTS_EVENT, onRebuild);");
    expect(gen).toContain("if (requests) setFavoriteFoods(requests);");
    expect(gen).toContain("generateRef.current(requests || undefined);");
    expect(gen).toContain("onClick={() => handleGenerate()}");
  });
  it("D16: no private packages links the Packages page", () => {
    expect(read("components/coach/package-assignment-control.tsx")).toContain("href={`/groups/${groupId}/business/packages`}");
    expect(read(PROFILE)).toMatch(/<PackageAssignmentControl\s+athleteId=\{params\.athleteId\}\s+groupId=\{params\.groupId\}/);
  });
});

describe("business and settings", () => {
  it("D7: each payment problem has its next step: Message for a failed card, Add sessions for a refund, Open Stripe for a dispute, and the name opens the profile", () => {
    const s = read("components/coach/payment-problems-section.tsx");
    expect(s).toContain('select("id, kind, group_id, athlete_id, amount_cents');
    expect(s).toContain('e.kind === "payment_failed"');
    expect(s).toContain("?draft=${encodeURIComponent(failedCardDraft(first))}");
    expect(s).toContain("href={addSessionsHref(client.groupId, client.athleteId)}");
    expect(s).toContain('e.kind === "dispute_opened" && <OpenStripeButton groupId={e.group_id} />');
    expect(s).toContain("href={`/groups/${client.groupId}/athletes/${client.athleteId}`}");
    expect(failedCardDraft("Sam")).toMatch(/^Hi Sam, a quick heads-up: your last card payment didn't go through/);
    expect(read("components/coach/open-stripe-button.tsx")).toContain('fetch("/api/stripe/connect/dashboard"');
  });
  it("D15: Pay when booking links the Packages page to connect Stripe", () => {
    expect(read("components/coach/desktop/public-session-types-editor.tsx")).toContain("href={`/groups/${groupId}/business/packages`}");
    expect(read("app/(coach)/groups/[groupId]/business/booking-page/page.tsx")).toContain("payToBookAvailable={payToBookAvailable} groupId={params.groupId} />");
  });
  it("D18: 'Turn on your public page' opens Availability on the public page block, which scrolls into view", () => {
    expect(AVAILABILITY_HREF).toBe(`/calendar?tab=availability#${PUBLIC_PAGE_ANCHOR}`);
    const a = read("components/coach/desktop/availability-settings.tsx");
    expect(a).toMatch(/<div id=\{PUBLIC_PAGE_ANCHOR\} className="scroll-mt-24">\s*<ScrollToHash ids=\{\[PUBLIC_PAGE_ANCHOR\]\} \/>\s*<ConsultationLinkBlock/);
  });
  it("D24: an invitation whose email failed offers Send again and Copy link right in the message", () => {
    const route = read("app/api/coaches/invite/route.ts");
    // one key on every path, so the answer never tells which kind of address it was
    expect(route).toContain("const unsent = sent.emailed ? {} : { unsentId: invite.id };");
    expect(route).toContain("const unsent = emailed ? {} : { unsentId: newUserId };");
    const form = read("components/coach/desktop/invite-coach-form.tsx");
    expect(form).toContain("{unsent && <UnsentInviteActions groupId={groupId} id={unsent.id} name={unsent.name} />}");
    // the Invitations list's own routes: by person first, then the in-app invitation
    expect(form).toContain('postJson("/api/coaches/invite/resend", { groupId, profileId: id })');
    expect(form).toContain('if (r.status === 404) r = await postJson("/api/org-invites/resend", { inviteId: id });');
    expect(form).toContain('postJson("/api/coaches/invite/link", { groupId, profileId: id })');
    expect(form).toContain("/org-invite/${id}");
  });
  it("D25: 'hand them over from the Team page' links the Team page", () => {
    expect(read("components/coach/desktop/add-client-button.tsx")).toContain("href={`/groups/${groupId}/branding?tab=team`}");
  });
  it("the hash helper only answers for the sections it was given", () => {
    expect(hashNames("#sign-in-options", ["sign-in-options"])).toBe("sign-in-options");
    expect(hashNames("#other", ["sign-in-options"])).toBeNull();
    expect(hashNames("", ["sign-in-options"])).toBeNull();
  });
});

describe("Ask Spot", () => {
  const roster = [{ id: "c-karina", fullName: "Karina Ramirez", groupId: "g2" }];
  const desk: NavContext = { role: "coach", device: "desktop", groupId: "g1", roster };
  const phone: NavContext = { role: "coach", device: "phone", groupId: "g1", roster };
  const athletePhone: NavContext = { role: "athlete", device: "phone", groupId: "g1" };
  const first = (m: string, ctx: NavContext) => {
    const r = resolveNavigation(m, ctx);
    return r.kind === "data" ? null : r.chips[0]?.href ?? null;
  };
  it("D12: Add a client opens Add client, from a place and from the how-to", () => {
    expect(first("add a client", desk)).toBe("/clients?add=1");
    expect(HOWTOS.find((h) => h.id === "add-client-before-signup")?.steps[0].href).toBe("/clients?add=1");
  });
  it("D13: Import opens Import program on the list; a client's program, balance and macro calculator open those places", () => {
    expect(first("import a program", desk)).toBe("/groups/g1/programs?import=1");
    expect(read("app/(coach)/groups/[groupId]/programs/page.tsx")).toContain("<ProgramImportLauncher groupId={params.groupId} autoOpen={openImport} />");
    expect(read("app/(coach)/groups/[groupId]/programs/import/page.tsx")).toContain("programs?import=1");
    expect(first("Karina's program", desk)).toBe("/groups/g2/athletes/c-karina?tab=program");
    expect(first("Karina's session balance", desk)).toBe("/groups/g2/athletes/c-karina?tab=settings#add-sessions");
    expect(first("Karina's macro calculator", desk)).toBe("/groups/g2/athletes/c-karina?tab=nutrition#calculate-targets");
    expect(read("components/coach/desktop/standing-macro-target-card.tsx")).toContain("id={CALCULATE_TARGETS_ANCHOR}");
  });
  it("P24: places a coach's phone sends elsewhere are desktop-only for a coach, and still on a client's phone", () => {
    for (const id of ["records", "challenges", "resources", "quick-tips"]) {
      const d = NAV_DESTINATIONS.find((x) => x.id === id)!;
      expect(d.coachDevices, id).toEqual(["desktop"]);
      expect(notOnPhone(d, phone), id).toBe(true);
      expect(notOnPhone(d, athletePhone), id).toBe(false);
      expect(notOnPhone(d, desk), id).toBe(false);
    }
    expect(NAV_DESTINATIONS.find((x) => x.id === "client-history")?.devices).toEqual(["desktop"]);
    const r = resolveNavigation("records", phone);
    expect(r.kind).toBe("unsure");
    if (r.kind !== "data") expect(r.text).toContain("desktop");
    expect(first("records", athletePhone)).toBe("/groups/g1/records");
  });
});

describe("phone width", () => {
  it("P17: the newest message clears the fixed composer and the bottom bar", () => {
    const t = read("components/messages/direct-message-thread.tsx");
    expect(t).toContain('fixedComposer ? "pb-[calc(9.75rem+env(safe-area-inset-bottom))]" : ""');
    expect(t).toContain('<div ref={bottomRef} className={fixedComposer ? "scroll-mb-[calc(9.75rem+env(safe-area-inset-bottom))]" : undefined} />');
  });
  it("P18: one bell below lg: the header bell is for lg and up, Spotlight's own bell is below lg", () => {
    expect(read("components/coach/coach-desktop-shell.tsx")).toMatch(/<div className="hidden lg:flex">\s*<HeaderNotificationBell scopeGroupId=\{groupId\} \/>/);
  });
});
