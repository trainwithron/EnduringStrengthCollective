import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const push = vi.hoisted(() => vi.fn(async () => 1));
vi.mock("@/lib/send-push", () => ({ sendPushToProfile: push }));
import { handlePaymentProblemEvent, problemText, whoFromMetadata, LOCK_SCREEN_TEXT } from "./payment-events";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

type Row = Record<string, any>;
// A stand-in database that remembers what is written and refuses a repeated Stripe event id.
function world(opts: { seats?: Row[]; profiles?: Row[]; failInsert?: boolean } = {}) {
  const tables: Record<string, Row[]> = { payment_events: [], notifications: [] };
  const db = {
    tables,
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let op: "select" | "insert" = "select";
      let values: Row = {};
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        insert: (v: Row) => ((op = "insert"), (values = v), q),
        maybeSingle: async () => run().then((r: any) => ({ data: r.data?.[0] ?? null, error: r.error })),
        then: (resolve: (v: unknown) => void) => run().then(resolve),
      };
      async function run(): Promise<any> {
        if (op === "insert") {
          if (opts.failInsert && table === "payment_events") return { data: null, error: { code: "XX000", message: "down" } };
          if (table === "payment_events" && tables.payment_events.some((r) => r.stripe_event_id === values.stripe_event_id)) return { data: null, error: { code: "23505", message: "dup" } };
          tables[table].push(values);
          return { data: null, error: null };
        }
        if (table === "group_memberships") return { data: (opts.seats ?? []).filter((r) => filters.every((f) => f(r))), error: null };
        if (table === "profiles") return { data: (opts.profiles ?? []).filter((r) => filters.every((f) => f(r))), error: null };
        return { data: [], error: null };
      }
      return q;
    },
  };
  return db;
}

const subMeta = { athlete_id: "ath", group_id: "grp", coach_package_id: "pk" };
function fakeStripe(over: Partial<{ sub: Record<string, string>; sessionMeta: Record<string, string> | null; invoice: unknown; charge: unknown }> = {}) {
  return {
    subscriptions: { retrieve: vi.fn(async () => ({ metadata: over.sub ?? subMeta })) },
    checkout: { sessions: { list: vi.fn(async () => ({ data: over.sessionMeta === null ? [] : [{ metadata: over.sessionMeta ?? { athlete_id: "ath", group_id: "grp" } }] })) } },
    invoices: { retrieve: vi.fn(async () => over.invoice ?? { parent: { subscription_details: { subscription: "sub_1" } } }) },
    charges: { retrieve: vi.fn(async () => over.charge ?? { id: "ch_1", payment_intent: "pi_1" }) },
  } as any;
}
const seats = [{ profile_id: "coach1", group_id: "grp", role: "coach" }];
const profiles = [{ id: "ath", full_name: "Sam Rivera" }];
const evt = (type: string, object: unknown, id = "evt_1") => ({ id, type, data: { object } }) as any;

beforeEach(() => push.mockClear());

describe("what the coach is told", () => {
  it("says what happened in plain words, with the name and amount, and never claims a balance changed", () => {
    expect(problemText("payment_failed", "Sam", 5000, "usd", null)).toBe("Sam's payment of $50.00 didn't go through. Stripe will try again; ask them to update their card if it keeps failing.");
    expect(problemText("refund", "Sam", 2500, "usd", null)).toBe("Sam was refunded $25.00 in Stripe. Their sessions were not changed here.");
    expect(problemText("dispute_opened", "Sam", 2500, "usd", null)).toContain("Answer it in your Stripe dashboard");
    expect(problemText("dispute_closed", "Sam", 2500, "usd", "you won")).toBe("The dispute over $25.00 from Sam was closed: you won.");
  });

  it("reads the owner from checkout metadata", () => {
    expect(whoFromMetadata({ athlete_id: "a", group_id: "g", coach_id: "c" })).toEqual({ athleteId: "a", groupId: "g", coachId: "c" });
    expect(whoFromMetadata(undefined)).toEqual({ athleteId: null, groupId: null, coachId: null });
  });
});

describe("the four events", () => {
  it("a failed payment on a client's subscription is recorded against their group and the coach is told, with nothing on the lock screen", async () => {
    const db = world({ seats, profiles });
    await handlePaymentProblemEvent(evt("invoice.payment_failed", { id: "in_1", amount_due: 5000, currency: "usd", parent: { subscription_details: { subscription: "sub_1" } } }), { db, stripe: fakeStripe() });
    expect(db.tables.payment_events).toHaveLength(1);
    expect(db.tables.payment_events[0]).toMatchObject({ stripe_event_id: "evt_1", kind: "payment_failed", group_id: "grp", athlete_id: "ath", amount_cents: 5000, stripe_object_id: "in_1" });
    expect(db.tables.notifications).toHaveLength(1);
    expect(db.tables.notifications[0]).toMatchObject({ profile_id: "coach1", group_id: "grp", type: "payment_problem", link_path: "/groups/grp/business" });
    expect(db.tables.notifications[0].body).toContain("Sam Rivera");
    expect(push).toHaveBeenCalledWith(db, "coach1", "A payment failed", LOCK_SCREEN_TEXT, "/groups/grp/business");
    expect(LOCK_SCREEN_TEXT).not.toMatch(/\$|Sam/);
  });

  it("a refund is recorded with the amount refunded, found through the checkout that made the charge", async () => {
    const db = world({ seats, profiles });
    const stripe = fakeStripe();
    await handlePaymentProblemEvent(evt("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 2500, currency: "usd" }, "evt_2"), { db, stripe });
    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 1 });
    expect(db.tables.payment_events[0]).toMatchObject({ kind: "refund", group_id: "grp", athlete_id: "ath", amount_cents: 2500, stripe_object_id: "ch_1" });
    expect(db.tables.notifications[0].body).toContain("Their sessions were not changed here");
  });

  it("a refund of a subscription payment is found through its invoice and subscription", async () => {
    const db = world({ seats, profiles });
    const stripe = fakeStripe({ sessionMeta: null });
    await handlePaymentProblemEvent(evt("charge.refunded", { id: "ch_9", payment_intent: "pi_9", invoice: "in_9", amount_refunded: 1000, currency: "usd" }, "evt_3"), { db, stripe });
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith("in_9");
    expect(db.tables.payment_events[0]).toMatchObject({ kind: "refund", group_id: "grp", athlete_id: "ath" });
  });

  it("a dispute opened and a dispute closed (won or lost) are recorded against the charge's owner", async () => {
    const db = world({ seats, profiles });
    const stripe = fakeStripe();
    await handlePaymentProblemEvent(evt("charge.dispute.created", { id: "dp_1", charge: "ch_1", amount: 2500, currency: "usd", status: "needs_response" }, "evt_4"), { db, stripe });
    await handlePaymentProblemEvent(evt("charge.dispute.closed", { id: "dp_1", charge: "ch_1", amount: 2500, currency: "usd", status: "won" }, "evt_5"), { db, stripe });
    expect(db.tables.payment_events.map((r) => [r.kind, r.stripe_object_id, r.detail])).toEqual([["dispute_opened", "dp_1", null], ["dispute_closed", "dp_1", "you won"]]);
    expect(db.tables.notifications).toHaveLength(2);
  });

  it("the same Stripe event delivered twice is recorded once and the coach is told once", async () => {
    const db = world({ seats, profiles });
    const e = evt("invoice.payment_failed", { id: "in_1", amount_due: 5000, currency: "usd", parent: { subscription_details: { subscription: "sub_1" } } });
    await handlePaymentProblemEvent(e, { db, stripe: fakeStripe() });
    await handlePaymentProblemEvent(e, { db, stripe: fakeStripe() });
    expect(db.tables.payment_events).toHaveLength(1);
    expect(db.tables.notifications).toHaveLength(1);
  });

  it("a coach's own plan payment failing is recorded against the coach and only they are told", async () => {
    const db = world({ seats, profiles });
    await handlePaymentProblemEvent(evt("invoice.payment_failed", { id: "in_2", amount_due: 4900, currency: "usd", parent: { subscription_details: { subscription: "sub_2" } } }, "evt_6"), { db, stripe: fakeStripe({ sub: { coach_id: "coach1", purchase_kind: "coach_lift_off" } }) });
    expect(db.tables.payment_events[0]).toMatchObject({ coach_id: "coach1", group_id: null, athlete_id: null });
    expect(db.tables.notifications).toHaveLength(1);
    expect(db.tables.notifications[0]).toMatchObject({ profile_id: "coach1", group_id: null, link_path: "/dashboard" });
    expect(db.tables.notifications[0].body).toContain("for your plan");
  });

  it("an event that cannot be matched to anyone is still recorded (the platform report finds it) and nobody is told", async () => {
    const db = world({ seats, profiles });
    const stripe = fakeStripe({ sessionMeta: null });
    stripe.invoices.retrieve = vi.fn(async () => {
      throw new Error("stripe down");
    });
    await handlePaymentProblemEvent(evt("charge.refunded", { id: "ch_x", payment_intent: "pi_x", invoice: "in_x", amount_refunded: 700, currency: "usd" }, "evt_7"), { db, stripe });
    expect(db.tables.payment_events[0]).toMatchObject({ kind: "refund", group_id: null, athlete_id: null, coach_id: null, amount_cents: 700 });
    expect(db.tables.notifications).toHaveLength(0);
  });

  it("if the record cannot be written the event is thrown back so Stripe sends it again, and nobody is told", async () => {
    const db = world({ seats, profiles, failInsert: true });
    await expect(handlePaymentProblemEvent(evt("invoice.payment_failed", { id: "in_1", amount_due: 5000, currency: "usd", parent: { subscription_details: { subscription: "sub_1" } } }), { db, stripe: fakeStripe() })).rejects.toBeTruthy();
    expect(db.tables.notifications).toHaveLength(0);
  });

  it("any other event does nothing", async () => {
    const db = world();
    await handlePaymentProblemEvent(evt("customer.created", {}), { db, stripe: fakeStripe() });
    expect(db.tables.payment_events).toHaveLength(0);
  });
});

describe("how it is wired", () => {
  it("the webhook hands the four events to it and nothing else about money changes", () => {
    const route = src("app/api/stripe/webhook/route.ts");
    for (const t of ["invoice.payment_failed", "charge.refunded", "charge.dispute.created", "charge.dispute.closed"]) expect(route).toContain(`case "${t}":`);
    expect(route).toContain("handlePaymentProblemEvent(event, { db: supabase, stripe })");
    const lib = src("lib/payment-events.ts");
    // it records and notifies: it never touches balances, sessions, subscriptions or Stripe objects
    expect(lib).not.toMatch(/session_credits|credit_purchases|apply_session_credit|membership_subscriptions|transfers\.|refunds\.create|subscriptions\.(update|cancel)|\.delete\(|\.update\(/);
  });

  it("the migration records and reports only: a coach reads their groups', nothing is written from a browser, the report is for a platform admin", () => {
    const sql = src("supabase/migrations/0409_payment_events.sql");
    expect(sql).toContain("revoke all on public.payment_events from anon, authenticated;\ngrant select on public.payment_events to authenticated;");
    expect(sql).toContain("stripe_event_id text not null unique");
    expect(sql).toContain("is_platform_admin");
    expect(sql).not.toMatch(/update public\.(session_credits|membership_subscriptions|credit_purchases)|delete from/);
  });

  it("the coach sees them on the Business page and the platform admin on a checks page, both read only", () => {
    expect(src("app/(coach)/groups/[groupId]/business/page.tsx")).toContain("<PaymentProblemsSection");
    const section = src("components/coach/payment-problems-section.tsx");
    expect(section).toContain('.from("payment_events")');
    expect(section).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    const admin = src("app/admin/payments/page.tsx");
    expect(admin).toContain('rpc("payment_reconciliation_report")');
    expect(admin).toContain("is_platform_admin");
  });
});
