import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAUGHT_UP, KIND_ORDER, KIND_SLOT, SLOT_TITLE, moreLabel, pickNeedsYou, sentences, type NeedsYouItem, type NeedsYouKind } from "./needs-you";
import { SESSION_SOON_MINUTES, loadNeedsYouItems } from "./needs-you-data";

const item = (id: string, kind: NeedsYouKind, order = 0, name = "Sam"): NeedsYouItem => ({ id, kind, name, sentence: "x", button: "Open", href: `/x/${id}`, order });

describe("the three slots", () => {
  it("has exactly three fixed slots with the wording Ron asked for, and every kind belongs to one", () => {
    expect(SLOT_TITLE).toEqual({ waiting: "Someone is waiting on you", due: "Something is due soon", slipping: "Someone may need a check-in" });
    for (const k of KIND_ORDER) expect(KIND_SLOT[k]).toBeDefined();
    expect(KIND_ORDER).toHaveLength(Object.keys(KIND_SLOT).length);
  });
  it("shows the single most urgent item of each slot", () => {
    const v = pickNeedsYou([item("a", "quiet_mild"), item("b", "quiet_strong"), item("c", "client_message"), item("d", "schedule_request"), item("e", "payment"), item("f", "session_soon")]);
    expect(v.slots.map((s) => s.item?.id)).toEqual(["d", "f", "b"]);
    expect(v.moreCount).toBe(3);
    expect(v.caughtUp).toBe(false);
  });
  it("a pause, freeze or cancel request ranks first in its slot, then a schedule request, then a message, then a group reply", () => {
    const v = pickNeedsYou([item("reply", "group_reply"), item("msg", "client_message"), item("move", "booking_request"), item("pause", "schedule_request")]);
    expect(v.slots[0].item?.id).toBe("pause");
    const v2 = pickNeedsYou([item("reply", "group_reply"), item("msg", "client_message"), item("move", "booking_request")]);
    expect(v2.slots[0].item?.id).toBe("move");
    expect(pickNeedsYou([item("reply", "group_reply"), item("msg", "client_message")]).slots[0].item?.id).toBe("msg");
  });
  it("within a kind, the one waiting longest or starting soonest comes first", () => {
    expect(pickNeedsYou([item("late", "client_message", 2000), item("early", "client_message", 1000)]).slots[0].item?.id).toBe("early");
    expect(pickNeedsYou([item("later", "session_soon", 5000), item("sooner", "session_soon", 4000)]).slots[1].item?.id).toBe("sooner");
  });
  it("a slot with nothing shows nothing", () => {
    const v = pickNeedsYou([item("p", "payment")]);
    expect(v.slots[0].item).toBeNull();
    expect(v.slots[1].item?.id).toBe("p");
    expect(v.slots[2].item).toBeNull();
    expect(v.moreCount).toBe(0);
  });
  it("never says you're caught up when some check could not be made", () => {
    const v = pickNeedsYou([], { incomplete: true });
    expect(v.caughtUp).toBe(false);
    expect(v.incomplete).toBe(true);
    expect(pickNeedsYou([item("a", "payment")], { incomplete: true }).incomplete).toBe(true);
    expect(pickNeedsYou([]).incomplete).toBe(false);
  });
  it("a standing state ranks below an event: sessions about to expire come before a client who is simply out of sessions", () => {
    expect(pickNeedsYou([item("p", "payment"), item("e", "expiring_credits")]).slots[1].item?.id).toBe("e");
    expect(pickNeedsYou([item("p", "payment"), item("l", "late_change")]).slots[1].item?.id).toBe("l");
  });
  it("says you're caught up when nothing needs you", () => {
    const v = pickNeedsYou([]);
    expect(v.caughtUp).toBe(true);
    expect(v.moreCount).toBe(0);
    expect(v.slots.every((s) => s.item === null)).toBe(true);
    expect(CAUGHT_UP).toBe("You're caught up.");
  });
  it("the same thing never counts twice", () => {
    const v = pickNeedsYou([item("a", "payment"), item("a", "payment"), item("b", "payment")]);
    expect(v.moreCount).toBe(1);
  });
  it("words the 'N more' link and the sentences plainly", () => {
    expect(moreLabel(4)).toBe("4 more");
    expect(sentences.scheduleRequest("freeze")).toBe("Asked to freeze their recurring sessions.");
    expect(sentences.clientMessage(1)).toBe("Sent you a message you haven't read.");
    expect(sentences.clientMessage(3)).toBe("Sent you 3 messages you haven't read.");
    expect(sentences.payment(-2)).toBe("Is out of sessions (owed 2).");
    expect(sentences.expiringCredits(1)).toBe("Has sessions that expire tomorrow.");
  });
});

// A stand-in database where every read returns the rows given for its table (and nothing otherwise).
function fakeDb(rows: Record<string, unknown[]>, failing: string[] = []) {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    const self = new Proxy(q, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => (failing.includes(table) ? resolve({ data: null, error: { message: "boom" } }) : resolve({ data: rows[table] ?? [], error: null }));
        if (prop === "maybeSingle") return () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null });
        return () => self;
      },
    });
    return self;
  };
  return { from: (t: string) => chain(t) } as never;
}

const NOW = new Date("2026-10-08T15:00:00Z");
const base = {
  coachId: "coach",
  timezone: "America/Los_Angeles",
  now: NOW,
  groupIds: ["g1"],
  todayBookings: [] as { id: string; athleteId: string; groupId: string; athleteName: string; startAt: string }[],
  needsPayment: [] as { athleteId: string; groupId: string; name: string; balance: number }[],
  lowReadiness: [] as { athleteId: string; groupId: string; name: string }[],
  quietTierByAthlete: new Map() as never,
  needsReplyThreads: [] as { postId: string; groupId: string; groupName: string; channel: string; authorName: string }[],
};

describe("gathering what needs the coach", () => {
  it("finds nothing for a coach with no groups, and never reads anything", async () => {
    expect(await loadNeedsYouItems(fakeDb({}), { ...base, groupIds: [] })).toEqual({ items: [], failed: [] });
  });
  it("a session starting within two hours counts; later, already started, or the coach's own does not", async () => {
    const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();
    const { items } = await loadNeedsYouItems(fakeDb({}), {
      ...base,
      todayBookings: [
        { id: "soon", athleteId: "a1", groupId: "g1", athleteName: "Ann", startAt: at(45) },
        { id: "edge", athleteId: "a2", groupId: "g1", athleteName: "Bo", startAt: at(SESSION_SOON_MINUTES) },
        { id: "late", athleteId: "a3", groupId: "g1", athleteName: "Cy", startAt: at(SESSION_SOON_MINUTES + 1) },
        { id: "past", athleteId: "a4", groupId: "g1", athleteName: "Di", startAt: at(-5) },
        { id: "mine", athleteId: "coach", groupId: "g1", athleteName: "Me", startAt: at(10) },
      ],
    });
    expect(items.filter((i) => i.kind === "session_soon").map((i) => i.id)).toEqual(["session:soon", "session:edge"]);
    expect(items[0].sentence).toMatch(/^Session starts at /);
  });
  it("brings in clients out of sessions, low readiness and a group reply from what Home already has", async () => {
    const { items } = await loadNeedsYouItems(fakeDb({}), {
      ...base,
      needsPayment: [{ athleteId: "a1", groupId: "g1", name: "Ann", balance: 0 }],
      lowReadiness: [{ athleteId: "a2", groupId: "g1", name: "Bo" }],
      needsReplyThreads: [{ postId: "p1", groupId: "g1", groupName: "Team", channel: "general", authorName: "Cy" }],
    });
    expect(items.map((i) => i.kind).sort()).toEqual(["group_reply", "low_readiness", "payment"]);
    expect(items.find((i) => i.kind === "group_reply")?.href).toBe("/groups/g1/feed?channel=general&highlight=p1");
  });
  it("turns requests, unread messages, late changes and injuries into items, with names and one entry per client for messages", async () => {
    const { items } = await loadNeedsYouItems(
      fakeDb({
        schedule_requests: [{ id: "r1", athlete_id: "a1", group_id: "g1", kind: "pause", created_at: "2026-10-07T10:00:00Z" }],
        booking_requests: [{ id: "b1", athlete_id: "a2", group_id: "g1", created_at: "2026-10-07T11:00:00Z" }],
        direct_messages: [
          { sender_id: "a3", group_id: "g1", created_at: "2026-10-06T10:00:00Z" },
          { sender_id: "a3", group_id: "g1", created_at: "2026-10-07T10:00:00Z" },
        ],
        bookings: [{ id: "k1", athlete_id: "a4", group_id: "g1", start_at: "2026-10-06T09:00:00Z" }],
        athlete_injury_status: [{ athlete_id: "a5" }, { athlete_id: "outsider" }],
        group_memberships: [
          { group_id: "g1", profile_id: "a1" },
          { group_id: "g1", profile_id: "a5" },
        ],
        profiles: [
          { id: "a1", full_name: "Ann" },
          { id: "a2", full_name: "Bo" },
          { id: "a3", full_name: "Cy" },
          { id: "a4", full_name: "Di" },
          { id: "a5", full_name: "Ed" },
        ],
      }),
      base
    );
    const by = (k: string) => items.filter((i) => i.kind === k);
    expect(by("schedule_request")[0]).toMatchObject({ name: "Ann", sentence: "Asked to pause their recurring sessions." });
    expect(by("booking_request")).toHaveLength(1);
    expect(by("client_message")).toHaveLength(1);
    expect(by("client_message")[0]).toMatchObject({ name: "Cy", sentence: "Sent you 2 messages you haven't read.", href: "/groups/g1/messages/a3" });
    expect(by("late_change")[0].name).toBe("Di");
    // an injury only counts for a client of this coach
    expect(by("injury").map((i) => i.name)).toEqual(["Ed"]);
  });
  it("quiet clients: a strong tier and a mild tier both count; 'none' does not", async () => {
    const { items } = await loadNeedsYouItems(
      fakeDb({
        group_memberships: [
          { group_id: "g1", profile_id: "a1" },
          { group_id: "g1", profile_id: "a2" },
          { group_id: "g1", profile_id: "a3" },
        ],
        profiles: [
          { id: "a1", full_name: "Ann" },
          { id: "a2", full_name: "Bo" },
        ],
      }),
      { ...base, quietTierByAthlete: new Map([["a1", "strong"], ["a2", "mild"], ["a3", "none"]]) as never }
    );
    expect(items.filter((i) => i.kind === "quiet_strong").map((i) => i.name)).toEqual(["Ann"]);
    expect(items.filter((i) => i.kind === "quiet_mild").map((i) => i.name)).toEqual(["Bo"]);
    expect(items.some((i) => i.id === "quiet:a3")).toBe(false);
  });
  it("a read that fails leaves only its own kind out", async () => {
    const { items } = await loadNeedsYouItems(
      fakeDb({ schedule_requests: [{ id: "r1", athlete_id: "a1", group_id: "g1", kind: "cancel", created_at: "2026-10-07T10:00:00Z" }], profiles: [{ id: "a1", full_name: "Ann" }], direct_messages: [{ sender_id: "a2", group_id: "g1", created_at: "2026-10-07T10:00:00Z" }] }, ["direct_messages"]),
      base
    );
    expect(items.map((i) => i.kind)).toEqual(["schedule_request"]);
  });
  it("a read that returns an error answer (the database client does not throw) is reported as failed, never as 'nothing'", async () => {
    const out = await loadNeedsYouItems(fakeDb({}, ["schedule_requests", "direct_messages", "bookings"]), base);
    expect(out.items).toEqual([]);
    expect(out.failed.sort()).toEqual(["late changes", "schedule requests", "unread messages"]);
    expect(pickNeedsYou(out.items, { incomplete: out.failed.length > 0 }).caughtUp).toBe(false);
  });
  it("when every read worked and there is nothing, nothing failed", async () => {
    const out = await loadNeedsYouItems(fakeDb({}), base);
    expect(out).toEqual({ items: [], failed: [] });
  });
  it("only an injury marked lately counts (the query is limited to the last 14 days)", async () => {
    const seen: string[] = [];
    const db = {
      from: (t: string) => {
        const self: any = new Proxy({}, {
          get(_x, prop) {
            if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
            if (prop === "gte") return (col: string, val: string) => (seen.push(t + "." + col + ">=" + val), self);
            if (prop === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
            return () => self;
          },
        });
        return self;
      },
    } as never;
    await loadNeedsYouItems(db, base);
    const inj = seen.find((x) => x.startsWith("athlete_injury_status.marked_at>="));
    expect(inj).toBeDefined();
    const cutoff = new Date(inj!.split(">=")[1]).getTime();
    expect(Math.round((NOW.getTime() - cutoff) / 86_400_000)).toBe(14);
  });
});

describe("Home is wired as designed", () => {
  const page = readFileSync(join(__dirname, "..", "app/(coach)/dashboard/page.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("the strip sits above everything else and the stack below keeps all its panels", () => {
    expect(page.indexOf("<NeedsYouStrip")).toBeGreaterThan(-1);
    expect(page.indexOf("<NeedsYouStrip")).toBeLessThan(page.indexOf("<YourDayPanel"));
    for (const p of ["<CollectiveIntelligencePanel", "<OrgNotificationsPanel", "<NeedsReplyPanel", "<LateChangesPanel", "<ScheduleRequestsPanel", "<ExpiryCheckInPanel", "<InactiveClientsPanel", "<ProgressLookPanel", "<NeedsPaymentPanel"]) {
      expect(page.indexOf(p)).toBeGreaterThan(page.indexOf('id="needs-stack"'));
    }
  });
  it("the strip's buttons and 'N more' land on anchors that exist", () => {
    for (const id of ["needs-stack", "late-changes", "schedule-requests", "expiring"]) expect(page).toContain(`id="${id}"`);
  });
  it("a failure gathering the strip never fails the page", () => {
    expect(page).toMatch(/try \{\s*const needsYou = await loadNeedsYouItems\(/);
    expect(page).toContain("pickNeedsYou([], { incomplete: true })");
    expect(page).toContain("incomplete: needsYou.failed.length > 0");
  });
});
