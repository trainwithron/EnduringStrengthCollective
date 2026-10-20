import { describe, it, expect, beforeAll } from "vitest";
import { matchAction, describeAction } from "./assistant-actions";
import { matchClientByName, matchPastSession, resolvePastWindow, timeRangeLabel, NOT_FINISHED, NOT_TODAY_FUTURE, NOT_TODAY_OTHER_DAY } from "./past-session-request";
import { confirmAction, proposeAction } from "./assistant-actions-server";

// FIX 3B: "add Sarah to my calendar for the last hour" puts a session that already happened today on the calendar, marked came in, using exactly one session.

const at = (h: number, m = 0) => h * 60 + m;

describe("the words (matchAction)", () => {
  const past = (msg: string) => {
    const r = matchAction(msg);
    return r && r.id === "add_past_session" ? r.params.pastSession! : null;
  };
  it("recognises Ron's ways of saying it", () => {
    expect(past("add Sarah to my calendar for the last hour")).toEqual({ name: "sarah", window: { kind: "last", minutes: 60 } });
    expect(past("Add Sarah Steele to my calendar")).toEqual({ name: "sarah steele", window: { kind: "last", minutes: null } });
    expect(past("Sarah came in from 3 to 4")).toEqual({ name: "sarah", window: { kind: "range", start: { h: 3, m: 0, meridiem: null }, end: { h: 4, m: 0, meridiem: null } } });
    expect(past("log Sarah for the last hour.")).toEqual({ name: "sarah", window: { kind: "last", minutes: 60 } });
    expect(past("log sarah for the last 45 minutes")).toEqual({ name: "sarah", window: { kind: "last", minutes: 45 } });
    expect(past("put Johann on the calendar from 3:30 to 4:15 pm")?.window).toEqual({ kind: "range", start: { h: 3, m: 30, meridiem: null }, end: { h: 4, m: 15, meridiem: "pm" } });
    expect(past("add a session for Maria for the last half hour")).toEqual({ name: "maria", window: { kind: "last", minutes: 30 } });
    expect(past("Maria trained at 7am")).toEqual({ name: "maria", window: { kind: "at", start: { h: 7, m: 0, meridiem: "am" } } });
    expect(past("Johann came in today")).toEqual({ name: "johann", window: { kind: "last", minutes: null } });
  });
  it("another day or a later time is recognised so it can be refused, not guessed", () => {
    expect(past("add Sarah to my calendar tomorrow at 3")?.window).toEqual({ kind: "not_today", reason: "future" });
    expect(past("Sarah came in yesterday")?.window).toEqual({ kind: "not_today", reason: "other_day" });
  });
  it("leaves questions, settings and other requests alone", () => {
    for (const msg of ["how do I add Sarah to my calendar", "did Sarah come in today?", "set my gap to 10 minutes", "add 10 minutes to my buffer", "open Sarah's calendar", "add a client", "change clients to athletes", "add Sarah to my calendar for a check-in about her diet"]) {
      expect(matchAction(msg)?.id ?? null, msg).not.toBe("add_past_session");
    }
    // the existing settings still match as before
    expect(matchAction("set my gap to 10 minutes")?.id).toBe("set_buffer");
    expect(matchPastSession("i came in from 3 to 4")).toBeNull();
  });
});

describe("the time, today (resolvePastWindow)", () => {
  it("the last hour ends at the last quarter hour", () => {
    expect(resolvePastWindow({ kind: "last", minutes: 60 }, at(16, 7), 60)).toEqual({ startMin: at(15), endMin: at(16) });
    expect(resolvePastWindow({ kind: "last", minutes: null }, at(16, 7), 45)).toEqual({ startMin: at(15, 15), endMin: at(16) });
  });
  it("3 to 4 is the afternoon one when it is past 4 PM, and is refused as still to come at 9 AM", () => {
    const w = { kind: "range" as const, start: { h: 3, m: 0, meridiem: null }, end: { h: 4, m: 0, meridiem: null } };
    expect(resolvePastWindow(w, at(17), 60)).toEqual({ startMin: at(15), endMin: at(16) });
    expect(resolvePastWindow(w, at(9), 60)).toEqual({ startMin: at(3), endMin: at(4) });
    expect(resolvePastWindow({ ...w, start: { ...w.start, meridiem: "pm" }, end: { ...w.end, meridiem: "pm" } }, at(9), 60)).toEqual({ problem: NOT_TODAY_FUTURE });
  });
  it("never the future: a session still going, or later today, is refused", () => {
    expect(resolvePastWindow({ kind: "range", start: { h: 3, m: 0, meridiem: "pm" }, end: { h: 4, m: 0, meridiem: "pm" } }, at(15, 30), 60)).toEqual({ problem: NOT_FINISHED });
    expect(resolvePastWindow({ kind: "at", start: { h: 6, m: 0, meridiem: "pm" } }, at(15), 60)).toEqual({ problem: NOT_TODAY_FUTURE });
    expect(resolvePastWindow({ kind: "not_today", reason: "future" }, at(15), 60)).toEqual({ problem: NOT_TODAY_FUTURE });
    expect(resolvePastWindow({ kind: "not_today", reason: "other_day" }, at(15), 60)).toEqual({ problem: NOT_TODAY_OTHER_DAY });
    // the last hour at 12:20 AM would start yesterday
    expect(resolvePastWindow({ kind: "last", minutes: 60 }, at(0, 20), 60)).toEqual({ problem: NOT_TODAY_OTHER_DAY });
  });
  it("11 to 12 means 11 AM to noon", () => {
    expect(resolvePastWindow({ kind: "range", start: { h: 11, m: 0, meridiem: null }, end: { h: 12, m: 0, meridiem: null } }, at(13), 60)).toEqual({ startMin: at(11), endMin: at(12) });
  });
  it("labels", () => {
    expect(timeRangeLabel(at(15), at(16))).toBe("3:00-4:00 PM");
    expect(timeRangeLabel(at(11, 30), at(12, 30))).toBe("11:30 AM-12:30 PM");
  });
});

describe("the name (matchClientByName)", () => {
  const roster = [
    { id: "c1", fullName: "Sarah Steele", groupId: "g1" },
    { id: "c2", fullName: "Sarah Jones", groupId: "g2" },
    { id: "c3", fullName: "Johann Muller", groupId: "g3" },
  ];
  it("one match is that client; a first name two clients share is asked about; an unknown name is not guessed", () => {
    expect(matchClientByName("johann", roster)).toEqual({ client: roster[2] });
    expect(matchClientByName("sarah steele", roster)).toEqual({ client: roster[0] });
    expect(matchClientByName("sarah s", roster)).toEqual({ client: roster[0] });
    expect(matchClientByName("sarah", roster)).toEqual({ many: [roster[0], roster[1]] });
    expect(matchClientByName("maria", roster)).toEqual({ none: true });
  });
});

describe("the card (describeAction)", () => {
  it("says who, when, came in, and what it uses", () => {
    const req = { id: "add_past_session" as const, params: { pastSession: { name: "sarah", window: { kind: "last" as const, minutes: 60 } } } };
    expect(describeAction(req, { session: { clientName: "Sarah Steele", timeLabel: "3:00-4:00 PM", existing: "none" } }).title).toBe("Sarah Steele, today 3:00-4:00 PM, came in, uses 1 session.");
    expect(describeAction(req, { session: { clientName: "Sarah Steele", timeLabel: "3:00-4:00 PM", existing: "prepaid" } }).title).toBe("Sarah Steele, today 3:00-4:00 PM, came in, already paid when it was booked.");
  });
});

// ---- propose and confirm, against a stand-in database that does what the live book_session and mark_booking_attended do ----

type Row = Record<string, any>;
const COACH = "coach-1";
const TZ = "America/Los_Angeles";
// 4:07 PM in Las Vegas on Oct 20, 2026 (PDT, UTC-7).
const NOW = new Date("2026-10-20T23:07:00Z");

function fakeDb(bookings: Row[], credits: Record<string, number>) {
  const ledger: Row[] = [];
  const rpcCalls: string[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const rowsFor = (): Row[] => {
      if (table === "bookings") return bookings.filter((r) => filters.every((f) => f(r)));
      if (table === "group_memberships") return [{ profiles: { timezone: TZ } }];
      if (table === "coach_availability_windows") return [{ id: "w1", session_minutes: 60 }];
      return [];
    };
    const chain: any = {
      select: () => chain,
      eq: (k: string, v: any) => (filters.push((r) => r[k] === v), chain),
      lt: (k: string, v: any) => (filters.push((r) => r[k] < v), chain),
      gt: (k: string, v: any) => (filters.push((r) => r[k] > v), chain),
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
      insert: () => Promise.resolve({ error: null }),
      then: (resolve: any) => resolve({ data: rowsFor(), error: null }),
    };
    return chain;
  };
  const rpc = async (fn: string, args: Row) => {
    rpcCalls.push(fn);
    if (fn === "book_session") {
      // a coach booking: any confirmed booking of this coach at that time refuses it; otherwise an unsettled booking, no session taken
      if (bookings.some((b) => b.coach_id === args.p_coach_id && b.status === "confirmed" && b.start_at < args.p_end_at && b.end_at > args.p_start_at)) return { data: null, error: { message: "that slot was just taken" } };
      const id = `b${bookings.length + 1}`;
      bookings.push({ id, coach_id: args.p_coach_id, athlete_id: args.p_athlete_id, group_id: args.p_group_id, start_at: args.p_start_at, end_at: args.p_end_at, status: "confirmed", credit_state: "unsettled", attended_at: null, no_show: false });
      return { data: id, error: null };
    }
    if (fn === "mark_booking_attended") {
      // settle_booking_internal: once, never twice; nothing more from a prepaid one
      const b = bookings.find((x) => x.id === args.p_booking_id);
      if (!b || b.status !== "confirmed" || b.attended_at || b.no_show) return { data: false, error: null };
      b.attended_at = "now";
      if (b.credit_state === "unsettled") {
        credits[b.athlete_id] = (credits[b.athlete_id] ?? 0) - 1;
        ledger.push({ athlete: b.athlete_id, delta: -1, booking: b.id });
        b.credit_state = "settled";
        return { data: true, error: null };
      }
      return { data: false, error: null };
    }
    return { data: null, error: { message: "unknown" } };
  };
  return { supabase: { from, rpc } as any, ledger, rpcCalls };
}

const ROSTER = [
  { id: "sarah", fullName: "Sarah Steele", groupId: "g1" },
  { id: "sarah2", fullName: "Sarah Jones", groupId: "g2" },
  { id: "johann", fullName: "Johann Muller", groupId: "g3" },
];

beforeAll(() => {
  process.env.SHARE_LINK_SECRET = "test-secret";
});

async function proposeAndConfirm(msg: string, db: ReturnType<typeof fakeDb>) {
  const p = await proposeAction(db.supabase, COACH, msg, null, ROSTER, NOW);
  if (!p || !p.ok) return { proposal: p, confirm: null };
  return { proposal: p, confirm: await confirmAction(db.supabase, COACH, p.card.token) };
}

describe("propose and confirm", () => {
  it("shows the card first and changes nothing until Yes; Yes books it and takes exactly one session", async () => {
    const bookings: Row[] = [];
    const credits = { johann: 5 };
    const db = fakeDb(bookings, credits);
    const p = await proposeAction(db.supabase, COACH, "add Johann to my calendar for the last hour", null, ROSTER, NOW);
    expect(p && p.ok).toBe(true);
    if (!p || !p.ok) return;
    expect(p.card.title).toBe("Johann Muller, today 3:00-4:00 PM, came in, uses 1 session.");
    expect(p.card.confirmLabel).toBe("Yes");
    expect(bookings).toHaveLength(0);
    expect(db.rpcCalls).toEqual([]);
    const c = await confirmAction(db.supabase, COACH, p.card.token);
    expect(c.ok).toBe(true);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({ athlete_id: "johann", group_id: "g3", start_at: "2026-10-20T22:00:00.000Z", end_at: "2026-10-20T23:00:00.000Z", attended_at: "now" });
    expect(credits.johann).toBe(4);
    expect(db.ledger).toHaveLength(1);
    // the same card again (a second Yes) finds the booking and takes nothing more
    const again = await confirmAction(db.supabase, COACH, p.card.token);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toMatch(/already marked as came in, so nothing more was taken/);
    expect(bookings).toHaveLength(1);
    expect(credits.johann).toBe(4);
    expect(db.ledger).toHaveLength(1);
  });

  it("a booking for that client already overlapping that time is marked, not duplicated", async () => {
    const bookings: Row[] = [{ id: "b-existing", coach_id: COACH, athlete_id: "johann", group_id: "g3", start_at: "2026-10-20T22:30:00.000Z", end_at: "2026-10-20T23:30:00.000Z", status: "confirmed", credit_state: "unsettled", attended_at: null, no_show: false }];
    const credits = { johann: 3 };
    const db = fakeDb(bookings, credits);
    const { proposal, confirm } = await proposeAndConfirm("Johann came in from 3 to 4", db);
    expect(proposal && proposal.ok).toBe(true);
    if (proposal && proposal.ok) {
      // the card shows the booking that will be marked, at its own times
      expect(proposal.card.title).toBe("Johann Muller, today 3:30-4:30 PM, came in, uses 1 session.");
      expect(proposal.card.beforeText).toBe("On your calendar, not marked yet");
    }
    expect(confirm?.ok).toBe(true);
    expect(bookings).toHaveLength(1);
    expect(bookings[0].attended_at).toBe("now");
    expect(db.rpcCalls).toEqual(["mark_booking_attended"]);
    expect(credits.johann).toBe(2);
  });

  it("an overlapping booking already marked came in: nothing more taken, nothing made", async () => {
    const bookings: Row[] = [{ id: "b-done", coach_id: COACH, athlete_id: "johann", group_id: "g3", start_at: "2026-10-20T22:00:00.000Z", end_at: "2026-10-20T23:00:00.000Z", status: "confirmed", credit_state: "settled", attended_at: "earlier", no_show: false }];
    const credits = { johann: 3 };
    const db = fakeDb(bookings, credits);
    const p = await proposeAction(db.supabase, COACH, "log Johann for the last hour", null, ROSTER, NOW);
    expect(p && p.ok).toBe(false);
    if (p && !p.ok) expect(p.message).toBe("Johann Muller's 3:00-4:00 PM session today is already marked as came in, so nothing more was taken.");
    expect(bookings).toHaveLength(1);
    expect(credits.johann).toBe(3);
    expect(db.rpcCalls).toEqual([]);
  });

  it("a session the client paid for when booking: marked came in, nothing more taken", async () => {
    const bookings: Row[] = [{ id: "b-paid", coach_id: COACH, athlete_id: "johann", group_id: "g3", start_at: "2026-10-20T22:00:00.000Z", end_at: "2026-10-20T23:00:00.000Z", status: "confirmed", credit_state: "prepaid", attended_at: null, no_show: false }];
    const credits = { johann: 3 };
    const db = fakeDb(bookings, credits);
    const { proposal, confirm } = await proposeAndConfirm("add Johann to my calendar for the last hour", db);
    if (proposal && proposal.ok) expect(proposal.card.title).toMatch(/already paid when it was booked\.$/);
    expect(confirm?.ok).toBe(true);
    if (confirm?.ok) expect(confirm.message).toMatch(/Nothing more taken/);
    expect(credits.johann).toBe(3);
  });

  it("a name two clients share is asked about, and nothing is read or written", async () => {
    const db = fakeDb([], {});
    const p = await proposeAction(db.supabase, COACH, "add Sarah to my calendar for the last hour", null, ROSTER, NOW);
    expect(p && p.ok).toBe(false);
    if (p && !p.ok) expect(p.message).toBe("Which one: Sarah Steele, Sarah Jones? Say it again with the full name.");
    expect(db.rpcCalls).toEqual([]);
  });

  it("a time still to come is refused (that is normal scheduling)", async () => {
    const db = fakeDb([], {});
    const p = await proposeAction(db.supabase, COACH, "Johann came in from 5 to 6 pm", null, ROSTER, NOW);
    expect(p && p.ok).toBe(false);
    if (p && !p.ok) expect(p.message).toBe(NOT_TODAY_FUTURE);
    const tomorrow = await proposeAction(db.supabase, COACH, "add Johann to my calendar tomorrow at 3", null, ROSTER, NOW);
    expect(tomorrow && !tomorrow.ok && tomorrow.message).toBe(NOT_TODAY_FUTURE);
    expect(db.rpcCalls).toEqual([]);
  });

  it("another client already on the calendar then: nothing added, plain words", async () => {
    const bookings: Row[] = [{ id: "b-other", coach_id: COACH, athlete_id: "sarah", group_id: "g1", start_at: "2026-10-20T22:00:00.000Z", end_at: "2026-10-20T23:00:00.000Z", status: "confirmed", credit_state: "unsettled", attended_at: null, no_show: false }];
    const credits = { johann: 3, sarah: 3 };
    const db = fakeDb(bookings, credits);
    const { confirm } = await proposeAndConfirm("add Johann to my calendar for the last hour", db);
    expect(confirm?.ok).toBe(false);
    if (confirm && !confirm.ok) expect(confirm.message).toMatch(/already have another session on your calendar at that time, so nothing was added/);
    expect(bookings).toHaveLength(1);
    expect(credits).toEqual({ johann: 3, sarah: 3 });
  });

  it("a card from another coach, or a changed token, does nothing", async () => {
    const db = fakeDb([], { johann: 5 });
    const p = await proposeAction(db.supabase, COACH, "add Johann to my calendar for the last hour", null, ROSTER, NOW);
    if (!p || !p.ok) throw new Error("no card");
    expect((await confirmAction(db.supabase, "someone-else", p.card.token)).ok).toBe(false);
    expect((await confirmAction(db.supabase, COACH, p.card.token + "x")).ok).toBe(false);
    expect(db.rpcCalls).toEqual([]);
  });
});
