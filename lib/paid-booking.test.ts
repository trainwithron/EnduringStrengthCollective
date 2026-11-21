import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handlePaidCheckout, refundDecision, refundNoticeLine, runPaidBookingSweep, type PaidDeps } from "./paid-booking";
import { createPublicBooking, type PublicBookingStore } from "./public-booking-engine";
import { paysWhenBooking, publicSessionTypes } from "./public-booking";

// Wave 3 C7 (Ron, Nov 20): paid booking on the public page. Nothing is booked before the payment; a failed or abandoned payment leaves nothing; refunds follow the cancel
// rules, at most once each, and every one is told to the coach.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

type Row = Record<string, any>;

// A small stand-in for the database: enough of the query builder for lib/paid-booking.ts. Each query runs when awaited, so two runs at once interleave the way two servers would.
// A filter on a joined table ("bookings.status") is applied to the joined row, as PostgREST does with !inner.
function makeDb(tables: Record<string, Row[]>, rpcs: Record<string, (args: any) => any> = {}) {
  const get = (r: Row, col: string) => col.split(".").reduce((v: any, k) => (v == null ? undefined : v[k]), r);
  const cond = (col: string, op: string, val: string) => (r: Row) => {
    const v = get(r, col);
    if (op === "is") return val === "null" ? v === null || v === undefined : v === val;
    if (op === "lt") return v !== null && v !== undefined && v < val;
    if (op === "eq") return v === val;
    throw new Error("op " + op);
  };
  class Q {
    filters: ((r: Row) => boolean)[] = [];
    op: "select" | "update" | "insert" | "delete" = "select";
    patch: any;
    cols = "*";
    returning = false;
    lim: number | null = null;
    from = 0;
    to: number | null = null;
    one: "single" | "maybe" | null = null;
    constructor(public t: string) {}
    select(cols = "*") {
      if (this.op !== "select") this.returning = true;
      else this.cols = cols;
      return this;
    }
    update(p: any) {
      this.op = "update";
      this.patch = p;
      return this;
    }
    insert(p: any) {
      this.op = "insert";
      this.patch = p;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    eq(c: string, v: any) {
      this.filters.push((r) => get(r, c) === v);
      return this;
    }
    neq(c: string, v: any) {
      this.filters.push((r) => get(r, c) !== v);
      return this;
    }
    is(c: string, v: any) {
      this.filters.push((r) => (v === null ? get(r, c) == null : get(r, c) === v));
      return this;
    }
    not(c: string, op: string, v: any) {
      if (op !== "is" || v !== null) throw new Error("not " + op);
      this.filters.push((r) => get(r, c) != null);
      return this;
    }
    lt(c: string, v: any) {
      this.filters.push((r) => get(r, c) != null && get(r, c) < v);
      return this;
    }
    gte(c: string, v: any) {
      this.filters.push((r) => get(r, c) != null && get(r, c) >= v);
      return this;
    }
    in(c: string, vs: any[]) {
      this.filters.push((r) => vs.includes(get(r, c)));
      return this;
    }
    or(expr: string) {
      const parts = expr.split(",").map((p) => {
        const [col, op, ...rest] = p.split(".");
        return cond(col, op, rest.join("."));
      });
      this.filters.push((r) => parts.some((f) => f(r)));
      return this;
    }
    order() {
      return this;
    }
    limit(n: number) {
      this.lim = n;
      return this;
    }
    range(a: number, b: number) {
      this.from = a;
      this.to = b;
      return this;
    }
    maybeSingle() {
      this.one = "maybe";
      return this;
    }
    single() {
      this.one = "single";
      return this;
    }
    then(res: (v: any) => any, rej?: (e: any) => any) {
      return Promise.resolve()
        .then(() => this.run())
        .then(res, rej);
    }
    embed(r: Row): Row {
      const out = { ...r };
      if (this.cols.includes("bookings!public_booking_holds_booking_id_fkey") || this.cols.includes("bookings!booking_manage_links_booking_id_fkey"))
        out.bookings = (tables.bookings ?? []).find((b) => b.id === r.booking_id) ?? null;
      if (this.cols.includes("booking_manage_links!public_booking_holds_manage_link_id_fkey")) out.booking_manage_links = (tables.booking_manage_links ?? []).find((l) => l.id === r.manage_link_id) ?? null;
      return out;
    }
    run() {
      const rows = (tables[this.t] ??= []);
      if (this.op === "insert") {
        const list = Array.isArray(this.patch) ? this.patch : [this.patch];
        for (const p of list) rows.push({ id: p.id ?? `${this.t}-${rows.length + 1}`, ...p });
        return { data: this.one ? rows[rows.length - 1] : list, error: null };
      }
      const matched = rows.filter((r) => {
        const view = this.embed(r);
        return this.filters.every((f) => f(view));
      });
      if (this.op === "delete") {
        tables[this.t] = rows.filter((r) => !matched.includes(r));
        return { data: null, error: null };
      }
      if (this.op === "update") {
        for (const r of matched) Object.assign(r, this.patch);
        return { data: this.returning ? matched.map((r) => ({ ...r })) : null, error: null };
      }
      let picked = matched;
      if (this.to !== null) picked = picked.slice(this.from, this.to + 1);
      if (this.lim !== null) picked = picked.slice(0, this.lim);
      const data = picked.map((r) => this.embed(r));
      if (this.one) return { data: data[0] ?? null, error: null };
      return { data, error: null };
    }
  }
  return {
    from: (t: string) => new Q(t),
    rpc: async (name: string, args: any) => (rpcs[name] ? { data: rpcs[name](args), error: null } : { data: null, error: { message: "no such function" } }),
    tables,
  };
}

const COACH = "coach-1";
const TYPE = { id: "type-1", name: "1-on-1 training", durationMinutes: 60, locationKind: "in_person" as const, locationText: null, description: null, displayPriceCents: 6000, publicVisible: true, sortOrder: 0, organizationId: "org-1", payToBook: true };
const START = "2026-11-24T15:00:00.000Z";
const END = "2026-11-24T16:00:00.000Z";
const NOW = new Date("2026-11-20T15:00:00.000Z");
// a cancellation the sweep already saw ten minutes ago (a refund needs two sightings five minutes apart)
const SEEN_BEFORE = "2026-11-20T14:50:00.000Z";

function holdRow(over: Row = {}): Row {
  return {
    id: "hold-1",
    coach_id: COACH,
    session_type_id: TYPE.id,
    organization_id: "org-1",
    start_at: START,
    end_at: END,
    expires_at: "2026-11-20T15:33:00.000Z",
    guest_name: "Hewan Belete",
    guest_email: "hewan@example.com",
    guest_phone: null,
    note: null,
    amount_cents: 6000,
    stripe_account_id: "acct_1",
    checkout_session_id: "cs_1",
    state: "open",
    claimed_at: null,
    booking_id: null,
    manage_link_id: null,
    group_id: null,
    athlete_id: null,
    payment_intent_id: null,
    refund_claimed_at: null,
    refund_id: null,
    refunded_at: null,
    refund_reason: null,
    ...over,
  };
}

function setup(
  opts: { holds?: Row[]; busy?: { start: Date; end: Date }[]; bookings?: Row[]; links?: Row[]; refundFails?: number; alreadyRefunded?: boolean; requests?: Row[]; lateMoveCharged?: boolean } = {}
) {
  const db = makeDb(
    {
      public_booking_holds: opts.holds ?? [holdRow()],
      coach_booking_pages: [{ coach_id: COACH, slug: "ron" }],
      profiles: [{ id: COACH, full_name: "Ron Arnold" }],
      bookings: opts.bookings ?? [],
      booking_manage_links: opts.links ?? [],
      booking_requests: opts.requests ?? [],
    },
    { booking_late_move_charged: () => opts.lateMoveCharged === true }
  );
  const clock = { now: NOW };
  let bookingN = 0;
  const store: PublicBookingStore = {
    pageBySlug: async () => ({ coachId: COACH, slug: "ron", enabled: true, headline: null, intro: null, showPrices: false, coachName: "Ron Arnold" }),
    coachName: async () => "Ron Arnold",
    sessionTypes: async () => [TYPE],
    coachContext: async () => ({ timezone: "America/Chicago", windows: [], exceptions: [], bufferMinutes: 0, minimumNoticeHours: 0, cancellationWindowHours: 24 }) as any,
    busy: vi.fn(async () => opts.busy ?? []),
    hasUpcomingPublicBooking: async () => false,
    findGuestClient: async () => null,
    allowNewGuestClient: async () => true,
    createGuestClient: async () => ({ ok: true as const, athleteId: "athlete-1", groupId: "group-1" }),
    discardGuestClient: async () => {},
    book: vi.fn(async (a) => {
      bookingN++;
      const id = `booking-${bookingN}`;
      db.tables.bookings.push({ id, athlete_id: a.athleteId, coach_id: a.coachId, group_id: a.groupId, start_at: a.start.toISOString(), status: "confirmed", late_cancel: false, late_charge_state: null });
      return { ok: true as const, bookingId: id };
    }),
    insertLink: async (a) => {
      db.tables.booking_manage_links.push({ id: "link-1", booking_id: a.bookingId, coach_id: a.coachId, athlete_id: a.athleteId, guest_email: a.guestEmail, token_hash: a.tokenHash, created_at: clock.now.toISOString() });
      return { ok: true as const, linkId: "link-1" };
    },
    linkByHash: async () => null,
    repointLink: async () => {},
    cancel: vi.fn(async (id: string) => {
      const b = db.tables.bookings.find((x) => x.id === id);
      if (b) b.status = "cancelled";
      return { ok: true as const };
    }),
    mirror: async () => {},
  };
  let failures = opts.refundFails ?? 0;
  let refundN = 0;
  const deps = {
    db,
    store,
    refund: vi.fn(async () => {
      if (opts.alreadyRefunded) return { ok: false as const, alreadyRefunded: true, message: "charge_already_refunded" };
      if (failures > 0) {
        failures--;
        return { ok: false as const, alreadyRefunded: false, message: "card network down" };
      }
      refundN++;
      return { ok: true as const, refundId: `re_${refundN}` };
    }),
    sendEmail: vi.fn(async () => true),
    tellCoach: vi.fn(async () => {}),
    paymentReceived: vi.fn(async () => {}),
    bookedEmail: vi.fn(async () => {}),
    coachBookedPush: vi.fn(async () => {}),
    alertAdmin: vi.fn(async () => {}),
    now: () => clock.now,
  } satisfies PaidDeps;
  const later = (minutes: number) => (clock.now = new Date(clock.now.getTime() + minutes * 60000));
  return { db, store, deps, clock, later, hold: () => db.tables.public_booking_holds[0] };
}

const paidEvent = { holdId: "hold-1", paymentIntentId: "pi_1", paid: true, eventAccount: "acct_1", customerEmail: "hewan@example.com", amountTotal: 6000, currency: "usd" };

describe("the cancel rules decide the money", () => {
  it("cancelled in time: refunded; late and charged: kept; late and waiting: waits for the coach; late and let go: refunded; not cancelled: nothing", () => {
    expect(refundDecision({ status: "cancelled", late_cancel: false, late_charge_state: null })).toEqual({ kind: "refund", reason: "cancelled in time" });
    expect(refundDecision({ status: "cancelled", late_cancel: true, late_charge_state: "charged" })).toEqual({ kind: "keep" });
    expect(refundDecision({ status: "cancelled", late_cancel: true, late_charge_state: null })).toEqual({ kind: "keep" });
    expect(refundDecision({ status: "cancelled", late_cancel: true, late_charge_state: "flagged" })).toEqual({ kind: "wait" });
    expect(refundDecision({ status: "cancelled", late_cancel: true, late_charge_state: "waived" }).kind).toBe("refund");
    expect(refundDecision({ status: "confirmed", late_cancel: false, late_charge_state: null })).toEqual({ kind: "nothing" });
    expect(refundDecision(null).kind).toBe("refund");
    // a session the coach charged for a late move stays that visit's paid session: cancelling it later keeps the money
    expect(refundDecision({ status: "cancelled", late_cancel: false, late_charge_state: null }, { lateMoveCharged: true })).toEqual({ kind: "keep" });
  });
  it("the coach's line names the amount, the first name only, and why", () => {
    expect(refundNoticeLine(6000, "Hewan Belete", "cancelled in time")).toBe("Refunded $60.00 to Hewan: cancelled in time.");
  });
});

describe("a paid checkout", () => {
  it("paid: the booking, the private link and the coach's notices happen once, and nothing is refunded", async () => {
    const t = setup();
    expect(await handlePaidCheckout(t.deps, paidEvent)).toBe("booked");
    expect(t.hold()).toMatchObject({ state: "booked", booking_id: "booking-1", manage_link_id: "link-1", group_id: "group-1", athlete_id: "athlete-1", payment_intent_id: "pi_1" });
    expect(t.db.tables.bookings).toHaveLength(1);
    expect(t.deps.bookedEmail).toHaveBeenCalledTimes(1);
    expect(t.deps.paymentReceived).toHaveBeenCalledWith({ groupId: "group-1", athleteId: "athlete-1", amountCents: 6000, what: "1-on-1 training" });
    expect(t.deps.coachBookedPush).toHaveBeenCalledTimes(1);
    expect(t.deps.refund).not.toHaveBeenCalled();
    // the hold being booked is not "taken" for itself
    expect((t.store.busy as any).mock.calls[0][3]).toBe("hold-1");
  });

  it("not paid: nothing happens", async () => {
    const t = setup();
    expect(await handlePaidCheckout(t.deps, { ...paidEvent, paid: false })).toBe("unpaid");
    expect(t.db.tables.bookings).toHaveLength(0);
    expect(t.hold().state).toBe("open");
  });

  it("the same Stripe event twice (or two at once): one booking, one set of notices", async () => {
    const t = setup();
    const [a, b] = await Promise.all([handlePaidCheckout(t.deps, paidEvent), handlePaidCheckout(t.deps, paidEvent)]);
    expect([a, b].sort()).toEqual(["booked", "duplicate"]);
    expect(await handlePaidCheckout(t.deps, paidEvent)).toBe("duplicate");
    expect(t.db.tables.bookings).toHaveLength(1);
    expect(t.deps.bookedEmail).toHaveBeenCalledTimes(1);
    expect(t.deps.refund).not.toHaveBeenCalled();
  });

  it("the time was taken before the payment went through: refunded in full at once, the visitor and the coach told, nothing booked", async () => {
    const t = setup({ busy: [{ start: new Date(START), end: new Date(END) }] });
    expect(await handlePaidCheckout(t.deps, paidEvent)).toBe("refunded");
    expect(t.db.tables.bookings).toHaveLength(0);
    expect(t.deps.refund).toHaveBeenCalledWith({ paymentIntentId: "pi_1", stripeAccount: "acct_1", idempotencyKey: "public-booking-refund-hold-1" });
    expect(t.hold()).toMatchObject({ state: "refunded", refund_id: "re_1" });
    expect(t.deps.sendEmail).toHaveBeenCalledWith("hewan@example.com", "Your $60.00 refund", expect.stringContaining("taken just before your payment"));
    expect(t.deps.tellCoach).toHaveBeenCalledWith(expect.objectContaining({ coachId: COACH, body: "Refunded $60.00 to Hewan: the time was taken before the payment went through." }));
  });

  it("a payment that arrives after the hold lapsed is refunded, using the email Stripe has (the hold's was wiped)", async () => {
    const t = setup({ holds: [holdRow({ state: "lapsed", guest_name: null, guest_email: null })] });
    expect(await handlePaidCheckout(t.deps, paidEvent)).toBe("refunded");
    expect(t.db.tables.bookings).toHaveLength(0);
    expect(t.deps.refund).toHaveBeenCalledTimes(1);
    expect(t.deps.sendEmail).toHaveBeenCalledWith("hewan@example.com", "Your $60.00 refund", expect.stringContaining("after the time was released"));
  });

  it("an event from another Stripe account is ignored", async () => {
    const t = setup();
    expect(await handlePaidCheckout(t.deps, { ...paidEvent, eventAccount: "acct_other" })).toBe("ignored");
    expect(t.hold().state).toBe("open");
  });

  it("a refund that fails is thrown so Stripe sends the event again", async () => {
    const t = setup({ busy: [{ start: new Date(START), end: new Date(END) }], refundFails: 1 });
    await expect(handlePaidCheckout(t.deps, paidEvent)).rejects.toThrow("refund failed");
    expect(t.hold().refund_claimed_at).toBeNull();
  });
});

describe("the five-minute sweep", () => {
  it("abandoned: an unpaid hold that ran out lapses, the visitor's details are wiped, nothing is refunded or booked", async () => {
    const t = setup({ holds: [holdRow({ expires_at: "2026-11-20T14:00:00.000Z" })] });
    const r = await runPaidBookingSweep(t.deps);
    expect(r.lapsed).toBe(1);
    expect(t.hold()).toMatchObject({ state: "lapsed", guest_name: null, guest_email: null, guest_phone: null, note: null });
    expect(t.deps.refund).not.toHaveBeenCalled();
  });

  it("a hold still inside its time is left alone", async () => {
    const t = setup();
    expect((await runPaidBookingSweep(t.deps)).lapsed).toBe(0);
    expect(t.hold().state).toBe("open");
  });

  it("a paid hold that never became a booking is refunded after ten minutes", async () => {
    const t = setup({ holds: [holdRow({ state: "claimed", claimed_at: "2026-11-20T14:40:00.000Z", payment_intent_id: "pi_1" })] });
    expect((await runPaidBookingSweep(t.deps)).refunded).toBe(1);
    expect(t.hold()).toMatchObject({ state: "refunded", refund_id: "re_1", refund_reason: "the booking could not be finished" });
  });

  const booked = (status: string, late = false, charge: string | null = null) =>
    setup({
      holds: [holdRow({ state: "booked", booking_id: "b1", manage_link_id: "l1", group_id: "group-1", payment_intent_id: "pi_1", refund_candidate_at: SEEN_BEFORE })],
      bookings: [{ id: "b1", status, late_cancel: late, late_charge_state: charge, athlete_id: "athlete-1", coach_id: COACH, start_at: START }],
      links: [{ id: "l1", booking_id: "b1" }],
    });

  it("cancelled in time: refunded in full once, the coach and the visitor told", async () => {
    const t = booked("cancelled");
    expect((await runPaidBookingSweep(t.deps)).refunded).toBe(1);
    expect(t.hold()).toMatchObject({ state: "refunded", refund_id: "re_1", refund_reason: "cancelled in time" });
    expect(t.deps.tellCoach).toHaveBeenCalledWith(expect.objectContaining({ body: "Refunded $60.00 to Hewan: cancelled in time.", link: "/groups/group-1/business" }));
    expect(t.deps.sendEmail).toHaveBeenCalledWith("hewan@example.com", "Your $60.00 refund", expect.stringContaining("was cancelled"));
    // later runs do nothing more
    await runPaidBookingSweep(t.deps);
    expect(t.deps.refund).toHaveBeenCalledTimes(1);
  });

  it("late and charged: kept; late and waiting for the coach: nothing yet; still on: nothing", async () => {
    for (const [status, late, charge] of [
      ["cancelled", true, "charged"],
      ["cancelled", true, "flagged"],
      ["confirmed", false, null],
    ] as const) {
      const t = booked(status, late, charge);
      await runPaidBookingSweep(t.deps);
      expect(t.deps.refund).not.toHaveBeenCalled();
      expect(t.hold().state).toBe("booked");
    }
  });

  it("late and the coach let it go (Waive): refunded", async () => {
    const t = booked("cancelled", true, "waived");
    await runPaidBookingSweep(t.deps);
    expect(t.hold()).toMatchObject({ state: "refunded", refund_reason: "late cancel, you let it go" });
  });

  it("two sweeps at once refund once; the refund id is stored", async () => {
    const t = booked("cancelled");
    await Promise.all([runPaidBookingSweep(t.deps), runPaidBookingSweep(t.deps), runPaidBookingSweep(t.deps)]);
    expect(t.deps.refund).toHaveBeenCalledTimes(1);
    expect(t.hold().refund_id).toBe("re_1");
    expect(t.deps.tellCoach).toHaveBeenCalledTimes(1);
  });

  it("a refund that fails is tried again on the next run, with the same key", async () => {
    const t = setup({
      holds: [holdRow({ state: "booked", booking_id: "b1", manage_link_id: "l1", group_id: "group-1", payment_intent_id: "pi_1", refund_candidate_at: SEEN_BEFORE })],
      bookings: [{ id: "b1", status: "cancelled", late_cancel: false, late_charge_state: null, athlete_id: "athlete-1", coach_id: COACH }],
      links: [{ id: "l1", booking_id: "b1" }],
      refundFails: 1,
    });
    expect((await runPaidBookingSweep(t.deps)).failed).toBe(1);
    expect(t.hold().state).toBe("booked");
    expect((await runPaidBookingSweep(t.deps)).refunded).toBe(1);
    expect(t.deps.refund).toHaveBeenCalledTimes(2);
    const keys = (t.deps.refund as any).mock.calls.map((c: any[]) => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("a refund Stripe says already happened is recorded as done, never repeated", async () => {
    const t = setup({
      holds: [holdRow({ state: "booked", booking_id: "b1", manage_link_id: "l1", group_id: "group-1", payment_intent_id: "pi_1", refund_candidate_at: SEEN_BEFORE })],
      bookings: [{ id: "b1", status: "cancelled", late_cancel: false, late_charge_state: null, athlete_id: "athlete-1", coach_id: COACH }],
      links: [{ id: "l1", booking_id: "b1" }],
      alreadyRefunded: true,
    });
    await runPaidBookingSweep(t.deps);
    expect(t.hold().state).toBe("refunded");
    await runPaidBookingSweep(t.deps);
    expect(t.deps.refund).toHaveBeenCalledTimes(1);
  });

  it("a moved session keeps its payment: the visitor's link now points at the new booking", async () => {
    const t = setup({
      holds: [holdRow({ state: "booked", booking_id: "b1", manage_link_id: "l1", group_id: "group-1", payment_intent_id: "pi_1", refund_candidate_at: SEEN_BEFORE })],
      bookings: [
        { id: "b1", status: "cancelled", late_cancel: false, late_charge_state: null, athlete_id: "athlete-1", coach_id: COACH },
        { id: "b2", status: "confirmed", late_cancel: false, late_charge_state: null, athlete_id: "athlete-1", coach_id: COACH },
      ],
      links: [{ id: "l1", booking_id: "b2" }],
    });
    expect((await runPaidBookingSweep(t.deps)).followed).toBe(1);
    expect(t.hold()).toMatchObject({ state: "booked", booking_id: "b2" });
    expect(t.deps.refund).not.toHaveBeenCalled();
  });

  it("a session moved by an approved move request keeps its payment too", async () => {
    const t = setup({
      holds: [holdRow({ state: "booked", booking_id: "b1", manage_link_id: "l1", group_id: "group-1", payment_intent_id: "pi_1", refund_candidate_at: SEEN_BEFORE })],
      bookings: [
        { id: "b1", status: "cancelled", late_cancel: false, late_charge_state: null, athlete_id: "athlete-1", coach_id: COACH },
        { id: "b3", status: "confirmed", late_cancel: false, late_charge_state: null, athlete_id: "athlete-1", coach_id: COACH, start_at: "2026-11-25T15:00:00.000Z" },
      ],
      links: [{ id: "l1", booking_id: "b1" }],
      requests: [{ kind: "move", booking_id: "b1", status: "confirmed", new_start_at: "2026-11-25T15:00:00.000Z", decided_at: "2026-11-21T10:00:00.000Z" }],
    });
    await runPaidBookingSweep(t.deps);
    expect(t.hold().booking_id).toBe("b3");
    expect(t.deps.refund).not.toHaveBeenCalled();
  });
});

describe("nothing is booked without paying", () => {
  it("the free booking refuses a session set to Pay when booking, before any client, booking or link is made", async () => {
    const t = setup();
    const store = { ...t.store, coachContext: async () => ({ timezone: "America/Chicago", windows: [{ weekday: 2, startTime: "08:00", endTime: "12:00", slotDurationMinutes: 60 }], exceptions: [], bufferMinutes: 0, minimumNoticeHours: 0, cancellationWindowHours: 24 }) as any };
    const input = { slug: "ron", sessionTypeId: TYPE.id, startIso: START, name: "Hewan Belete", email: "hewan@example.com", honeypot: "", renderedAtMs: NOW.getTime() - 60000 };
    const result = await createPublicBooking(store, input, NOW);
    expect(result).toMatchObject({ ok: false, status: 402 });
    expect(t.store.book).not.toHaveBeenCalled();
    // the same time and person on a free session books (the refusal is only the switch)
    const free = await createPublicBooking({ ...store, sessionTypes: async () => [{ ...TYPE, payToBook: false }] }, input, NOW);
    expect(free.ok).toBe(true);
  });
  it("Pay when booking needs the switch AND a price of at least $1; its price always shows", () => {
    expect(paysWhenBooking({ payToBook: true, displayPriceCents: 6000 })).toBe(true);
    expect(paysWhenBooking({ payToBook: true, displayPriceCents: null })).toBe(false);
    expect(paysWhenBooking({ payToBook: true, displayPriceCents: 50 })).toBe(false);
    expect(paysWhenBooking({ payToBook: false, displayPriceCents: 6000 })).toBe(false);
    const [view] = publicSessionTypes([TYPE], false);
    expect(view).toMatchObject({ payToBook: true, priceLabel: "$60" });
  });
});

describe("the wiring", () => {
  it("checkout: the organization's own account, today's fee, card only, closes at 30 minutes, the time held first and checked again", () => {
    const route = read("app/api/public-booking/[slug]/pay/route.ts");
    expect(route).toContain("checkPublicBooking(store,");
    expect(route).toContain("feePercentForOrg(db, type.organizationId)");
    expect(route).toContain("application_fee_amount: platformFeeCents(amountCents, feePercent)");
    expect(route).toContain('payment_method_types: ["card"]');
    expect(route).toContain("expires_at: Math.floor(nowMs / 1000) + CHECKOUT_MINUTES * 60");
    expect(route).toContain("{ stripeAccount: accountId, idempotencyKey: `public-booking-checkout-${hold.id}` }");
    expect(route).toContain("await stripe.checkout.sessions.expire(");
    expect(route).toContain("await store.busy(page.coachId, new Date(start.getTime() - 86400000), new Date(end.getTime() + 86400000), hold.id);");
    expect(route).not.toMatch(/price: ["']price_/);
  });
  it("the webhook books only on the coach's account; the five-minute job runs the sweep; refunds give back Spotlight's fee", () => {
    const hook = read("app/api/stripe/webhook/route.ts");
    expect(hook).toContain("if (purchaseKind === PAID_BOOKING_KIND) {\n          if (!connectedAccount) break;");
    expect(read("app/api/cron/process-booking-waitlist/route.ts")).toContain("runPaidBookingSweep(paidBookingDeps(supabase, appOrigin(request)))");
    expect(read("lib/paid-booking-server.ts")).toContain("refund_application_fee: true");
  });
  it("held times are busy on the public page; a paid session shows on the coach's calendar and on a late change", () => {
    expect(read("lib/public-booking-store.ts")).toContain("heldTimes(db, coachId, from, to, exceptHoldId)");
    expect(read("app/(coach)/groups/[groupId]/calendar/[date]/page.tsx")).toContain("Paid online {paidDollars(");
    expect(read("components/coach/late-changes-panel.tsx")).toContain("Charge keeps it; Waive refunds it in full.");
  });
});

describe("review fixes (Nov 20)", () => {
  const cancelledBooking = (over: Row = {}) => ({ id: "b1", status: "cancelled", late_cancel: false, late_charge_state: null, athlete_id: "athlete-1", coach_id: COACH, group_id: "group-1", start_at: START, ...over });
  const bookedHold = (over: Row = {}) => holdRow({ state: "booked", booking_id: "b1", manage_link_id: "l1", group_id: "group-1", payment_intent_id: "pi_1", ...over });

  it("1. the server stops after the booking is made but before it is recorded: the retry changes nothing, and the sweep ADOPTS the booking (new private link emailed), never refunds it", async () => {
    const t = setup();
    const realFrom = t.db.from;
    let failed = false;
    (t.db as any).from = (name: string) => {
      const q: any = realFrom(name);
      if (name === "public_booking_holds" && !failed) {
        const update = q.update.bind(q);
        q.update = (p: any) => {
          if (p.state === "booked") {
            failed = true;
            return { eq: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "connection lost" } }) }) };
          }
          return update(p);
        };
      }
      return q;
    };
    await expect(handlePaidCheckout(t.deps, paidEvent)).rejects.toThrow("could not record the booking");
    (t.db as any).from = realFrom;
    expect(t.db.tables.bookings).toHaveLength(1);
    expect(await handlePaidCheckout(t.deps, paidEvent)).toBe("duplicate");
    const oldToken = t.db.tables.booking_manage_links[0].token_hash;

    t.later(11);
    const r = await runPaidBookingSweep(t.deps);
    expect(r).toMatchObject({ adopted: 1, refunded: 0 });
    expect(t.hold()).toMatchObject({ state: "booked", booking_id: "booking-1", manage_link_id: "link-1", group_id: "group-1", athlete_id: "athlete-1" });
    expect(t.deps.refund).not.toHaveBeenCalled();
    expect(t.db.tables.booking_manage_links[0].token_hash).not.toBe(oldToken);
    expect(t.deps.bookedEmail).toHaveBeenCalledTimes(1);
    expect(t.deps.paymentReceived).toHaveBeenCalledTimes(1);
    expect(t.db.tables.bookings[0].status).toBe("confirmed");
  });

  it("1. a stuck payment with no live booking is still refunded (a cancelled one is not adopted)", async () => {
    const t = setup({
      holds: [holdRow({ state: "claimed", claimed_at: "2026-11-20T14:40:00.000Z", payment_intent_id: "pi_1" })],
      bookings: [cancelledBooking()],
      links: [{ id: "l1", booking_id: "b1", coach_id: COACH, guest_email: "hewan@example.com", athlete_id: "athlete-1", created_at: "2026-11-20T14:40:01.000Z" }],
    });
    const r = await runPaidBookingSweep(t.deps);
    expect(r).toMatchObject({ adopted: 0, refunded: 1 });
  });

  it("2. a cancellation is refunded only when seen on two runs five minutes apart", async () => {
    const t = setup({ holds: [bookedHold()], bookings: [cancelledBooking()], links: [{ id: "l1", booking_id: "b1" }] });
    await runPaidBookingSweep(t.deps);
    expect(t.deps.refund).not.toHaveBeenCalled();
    expect(t.hold().refund_candidate_at).toBe(NOW.toISOString());
    t.later(2);
    await runPaidBookingSweep(t.deps);
    expect(t.deps.refund).not.toHaveBeenCalled();
    t.later(4);
    await runPaidBookingSweep(t.deps);
    expect(t.deps.refund).toHaveBeenCalledTimes(1);
  });

  it("2. a session caught mid-move (old one cancelled, link not yet moved) is never refunded: next run the payment follows the new session", async () => {
    const t = setup({ holds: [bookedHold()], bookings: [cancelledBooking()], links: [{ id: "l1", booking_id: "b1" }] });
    await runPaidBookingSweep(t.deps);
    t.db.tables.bookings.push({ id: "b2", status: "confirmed", late_cancel: false, late_charge_state: null, athlete_id: "athlete-1", coach_id: COACH });
    t.db.tables.booking_manage_links[0].booking_id = "b2";
    t.later(6);
    expect((await runPaidBookingSweep(t.deps)).followed).toBe(1);
    expect(t.hold()).toMatchObject({ booking_id: "b2", refund_candidate_at: null });
    t.later(10);
    await runPaidBookingSweep(t.deps);
    expect(t.deps.refund).not.toHaveBeenCalled();
  });

  it("2. a guest moving with their link repoints it before the old session is cancelled", () => {
    const engine = read("lib/public-booking-engine.ts");
    expect(engine.indexOf("await store.repointLink(link.linkId, newBookingId);\n    const cancelled = await store.cancel(link.bookingId);")).toBeGreaterThan(0);
  });

  it("3. every cancelled paid session is found, however many paid sessions there are", async () => {
    const holds: Row[] = [];
    const bookings: Row[] = [];
    for (let i = 0; i < 1200; i++) {
      const n = String(i).padStart(5, "0");
      holds.push(holdRow({ id: `hold-${n}`, state: "booked", booking_id: `b-${n}`, group_id: "group-1", payment_intent_id: `pi_${n}`, refund_candidate_at: i === 1150 ? SEEN_BEFORE : null }));
      bookings.push({ id: `b-${n}`, status: i === 1150 ? "cancelled" : "confirmed", late_cancel: false, late_charge_state: null, athlete_id: "athlete-1", coach_id: COACH });
    }
    const t = setup({ holds, bookings });
    expect((await runPaidBookingSweep(t.deps)).refunded).toBe(1);
    expect(t.db.tables.public_booking_holds.find((h) => h.id === "hold-01150")?.state).toBe("refunded");
    expect(read("lib/paid-booking.ts")).not.toContain(".limit(500)");
  });

  it("4. a hold that lapses between the read and the claim: the payment is refunded, not called a duplicate", async () => {
    const t = setup();
    const realFrom = t.db.from;
    let reads = 0;
    (t.db as any).from = (name: string) => {
      const q: any = realFrom(name);
      if (name === "public_booking_holds") {
        const run = q.run.bind(q);
        q.run = () => {
          const out = run();
          if (q.op === "select" && ++reads === 1) {
            // the five-minute job lapses it just after this read
            Object.assign(t.db.tables.public_booking_holds[0], { state: "lapsed", guest_name: null, guest_email: null });
          }
          return out;
        };
      }
      return q;
    };
    expect(await handlePaidCheckout(t.deps, paidEvent)).toBe("refunded");
    expect(t.deps.refund).toHaveBeenCalledTimes(1);
    expect(t.db.tables.bookings).toHaveLength(0);
  });

  it("4. a late payment whose refund failed is refunded by the sweep", async () => {
    const t = setup({ holds: [holdRow({ state: "lapsed", guest_name: null, guest_email: null, payment_intent_id: "pi_1" })] });
    expect((await runPaidBookingSweep(t.deps)).refunded).toBe(1);
    expect(t.hold().state).toBe("refunded");
  });

  it("5. the hold is gone and the refund fails: thrown, so Stripe sends the event again", async () => {
    const t = setup({ holds: [], refundFails: 1 });
    await expect(handlePaidCheckout(t.deps, paidEvent)).rejects.toThrow("refund failed");
    expect(await handlePaidCheckout(t.deps, paidEvent)).toBe("refunded");
    expect(t.deps.refund).toHaveBeenCalledTimes(2);
  });

  it("a. a session charged for a late move and later cancelled keeps the money, as it keeps the session", async () => {
    const t = setup({ holds: [bookedHold({ refund_candidate_at: SEEN_BEFORE })], bookings: [cancelledBooking()], links: [{ id: "l1", booking_id: "b1" }], lateMoveCharged: true });
    await runPaidBookingSweep(t.deps);
    expect(t.deps.refund).not.toHaveBeenCalled();
    expect(t.hold()).toMatchObject({ state: "booked", refund_candidate_at: null });
  });

  it("b. a payment that is not the price (amount or currency) is refunded, nothing is booked, and the admin is told", async () => {
    for (const odd of [{ amountTotal: 100 }, { currency: "eur" }]) {
      const t = setup();
      expect(await handlePaidCheckout(t.deps, { ...paidEvent, ...odd })).toBe("refunded");
      expect(t.db.tables.bookings).toHaveLength(0);
      expect(t.deps.alertAdmin).toHaveBeenCalledTimes(1);
      expect(t.hold()).toMatchObject({ state: "refunded", refund_reason: "the amount paid did not match the price" });
    }
  });

  it("c. nothing is rolled back by hand (no cancel notice to the coach): an unrecorded booking is adopted instead", () => {
    const lib = read("lib/paid-booking.ts");
    expect(lib).not.toContain("store.cancel(");
    expect(lib).toContain('if (bookedError) throw new Error("could not record the booking on its hold");');
  });

  it("e. the editor turns Pay when booking off with the price, and the database refuses it on without a price or a ready Stripe account", () => {
    expect(read("components/coach/desktop/public-session-types-editor.tsx")).toContain("persist(t.id, { display_price_cents: cents, pay_to_book: false });");
    const sql = read("supabase/migrations/0462_wave3_calendar.sql");
    expect(sql).toContain("create trigger session_types_guard_pay_to_book before insert or update on public.session_types");
    expect(sql).toContain("a.status = 'ready'");
  });
});
