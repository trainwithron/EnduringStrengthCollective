import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const push = vi.hoisted(() => vi.fn(async () => 1));
vi.mock("@/lib/send-push", () => ({ sendPushToProfile: push }));
import { handlePaymentProblemEvent, invoiceIdOfCharge, problemText, subscriptionIdOfInvoice, whoFromMetadata, LOCK_SCREEN_TEXT } from "./payment-events";

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
      let head = false;
      const q: any = {
        select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
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
        const source = table === "group_memberships" ? opts.seats ?? [] : table === "profiles" ? opts.profiles ?? [] : tables[table] ?? [];
        const rows = source.filter((r) => filters.every((f) => f(r)));
        return head ? { count: rows.length, data: [], error: null } : { data: rows, error: null };
      }
      return q;
    },
  };
  return db;
}

const subMeta = { athlete_id: "ath", group_id: "grp", coach_package_id: "pk" };
// A Stripe stand-in. `shape` is which Stripe API version's field layout the invoice and charge use.
function fakeStripe(over: Partial<{ sub: Record<string, string>; sessionMeta: Record<string, string> | null; shape: "older" | "newer"; failOn: string; missingSub: boolean }> = {}) {
  const fail = (what: string) => {
    if (over.failOn === what) throw Object.assign(new Error("stripe down"), { statusCode: 500 });
  };
  return {
    subscriptions: {
      retrieve: vi.fn(async () => {
        fail("subscription");
        if (over.missingSub) throw Object.assign(new Error("No such subscription"), { code: "resource_missing", statusCode: 404 });
        return { metadata: over.sub ?? subMeta };
      }),
    },
    checkout: {
      sessions: {
        list: vi.fn(async () => {
          fail("sessions");
          return { data: over.sessionMeta === undefined || over.sessionMeta === null ? [] : [{ metadata: over.sessionMeta }] };
        }),
      },
    },
    invoices: {
      retrieve: vi.fn(async () => {
        fail("invoice");
        return over.shape === "older" ? { id: "in_9", subscription: "sub_1" } : { id: "in_9", parent: { subscription_details: { subscription: "sub_1" } } };
      }),
    },
    invoicePayments: {
      list: vi.fn(async () => {
        fail("invoicePayments");
        return { data: [{ invoice: "in_9" }] };
      }),
    },
    charges: { retrieve: vi.fn(async () => ({ id: "ch_1", payment_intent: "pi_1" })) },
  } as any;
}
const seats = [{ profile_id: "coach1", group_id: "grp", role: "coach" }];
const profiles = [{ id: "ath", full_name: "Sam Rivera" }];
const evt = (type: string, object: unknown, id = "evt_1") => ({ id, type, data: { object } }) as any;
const failedInvoice = (id = "in_1", attempt = 1) => ({ id, amount_due: 5000, currency: "usd", attempt_count: attempt, parent: { subscription_details: { subscription: "sub_1" } } });

beforeEach(() => push.mockClear());

describe("what the coach is told", () => {
  it("says what happened in plain words, with the name and amount, and never claims a balance changed", () => {
    expect(problemText("payment_failed", "Sam", 5000, "usd", null)).toBe("Sam's payment of $50.00 didn't go through. Stripe will try again; ask them to update their card if it keeps failing.");
    expect(problemText("refund", "Sam", 2500, "usd", null, 2500)).toBe("Sam was refunded $25.00 in Stripe. Their sessions were not changed here.");
    expect(problemText("refund", "Sam", 1000, "usd", null, 3500)).toBe("Sam was refunded $10.00 in Stripe ($35.00 refunded in total). Their sessions were not changed here.");
    expect(problemText("dispute_opened", "Sam", 2500, "usd", null)).toContain("Answer it in your Stripe dashboard");
    expect(problemText("dispute_closed", "Sam", 2500, "usd", "you won")).toBe("The dispute over $25.00 from Sam was closed: you won.");
  });

  it("reads the owner from checkout metadata", () => {
    expect(whoFromMetadata({ athlete_id: "a", group_id: "g", coach_id: "c" })).toEqual({ athleteId: "a", groupId: "g", coachId: "c" });
    expect(whoFromMetadata(undefined)).toEqual({ athleteId: null, groupId: null, coachId: null });
  });
});

describe("both shapes Stripe sends", () => {
  it("an invoice's subscription is found in the newer place and the older one", () => {
    expect(subscriptionIdOfInvoice({ parent: { subscription_details: { subscription: "sub_new" } } } as any)).toBe("sub_new");
    expect(subscriptionIdOfInvoice({ parent: { subscription_details: { subscription: { id: "sub_obj" } } } } as any)).toBe("sub_obj");
    expect(subscriptionIdOfInvoice({ subscription: "sub_old" } as any)).toBe("sub_old");
    expect(subscriptionIdOfInvoice({} as any)).toBeNull();
  });

  it("a charge's invoice is its own field when it has one (older), else the invoice payment of its payment intent (newer)", async () => {
    const stripe = fakeStripe();
    expect(await invoiceIdOfCharge(stripe, { id: "ch", invoice: "in_old", payment_intent: "pi" } as any)).toBe("in_old");
    expect(stripe.invoicePayments.list).not.toHaveBeenCalled();
    expect(await invoiceIdOfCharge(stripe, { id: "ch", payment_intent: "pi_77" } as any)).toBe("in_9");
    expect(stripe.invoicePayments.list).toHaveBeenCalledWith({ payment: { type: "payment_intent", payment_intent: "pi_77" }, limit: 1 });
    expect(await invoiceIdOfCharge(stripe, { id: "ch", payment_intent: null } as any)).toBeNull();
  });
});

describe("the four events", () => {
  it("a failed payment on a client's subscription is recorded against their group and the coach is told, with nothing on the lock screen", async () => {
    const db = world({ seats, profiles });
    await handlePaymentProblemEvent(evt("invoice.payment_failed", failedInvoice()), { db, stripe: fakeStripe() });
    expect(db.tables.payment_events).toHaveLength(1);
    expect(db.tables.payment_events[0]).toMatchObject({ stripe_event_id: "evt_1", kind: "payment_failed", group_id: "grp", athlete_id: "ath", amount_cents: 5000, stripe_object_id: "in_1", subscription_id: "sub_1", detail: "attempt 1" });
    expect(db.tables.notifications).toHaveLength(1);
    expect(db.tables.notifications[0]).toMatchObject({ profile_id: "coach1", group_id: "grp", type: "payment_problem", link_path: "/groups/grp/business" });
    expect(db.tables.notifications[0].body).toContain("Sam Rivera");
    expect(push).toHaveBeenCalledWith(db, "coach1", "A payment failed", LOCK_SCREEN_TEXT, "/groups/grp/business");
    expect(LOCK_SCREEN_TEXT).not.toMatch(/\$|Sam/);
  });

  it("Stripe's retries of the same invoice are each recorded, but the coach is told only once", async () => {
    const db = world({ seats, profiles });
    const stripe = fakeStripe();
    await handlePaymentProblemEvent(evt("invoice.payment_failed", failedInvoice("in_1", 1), "evt_a"), { db, stripe });
    await handlePaymentProblemEvent(evt("invoice.payment_failed", failedInvoice("in_1", 2), "evt_b"), { db, stripe });
    await handlePaymentProblemEvent(evt("invoice.payment_failed", failedInvoice("in_1", 3), "evt_c"), { db, stripe });
    expect(db.tables.payment_events.map((r) => r.detail)).toEqual(["attempt 1", "attempt 2", "attempt 3"]);
    expect(db.tables.notifications).toHaveLength(1);
    expect(push).toHaveBeenCalledTimes(1);
    // a different invoice (next month) is announced again
    await handlePaymentProblemEvent(evt("invoice.payment_failed", failedInvoice("in_2", 1), "evt_d"), { db, stripe });
    expect(db.tables.notifications).toHaveLength(2);
  });

  it("a refund is recorded with THIS refund and the running total, found through the checkout that made the charge", async () => {
    const db = world({ seats, profiles });
    const stripe = fakeStripe({ sessionMeta: { athlete_id: "ath", group_id: "grp" } });
    await handlePaymentProblemEvent(evt("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 2500, currency: "usd" }, "evt_2"), { db, stripe });
    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 1 });
    expect(db.tables.payment_events[0]).toMatchObject({ kind: "refund", group_id: "grp", athlete_id: "ath", amount_cents: 2500, total_cents: 2500, stripe_object_id: "ch_1" });
    expect(db.tables.notifications[0].body).toContain("Their sessions were not changed here");
    // a second partial refund on the same charge: the charge now shows $35 refunded, so this refund is $10
    await handlePaymentProblemEvent(evt("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 3500, currency: "usd" }, "evt_3"), { db, stripe });
    expect(db.tables.payment_events[1]).toMatchObject({ amount_cents: 1000, total_cents: 3500 });
    expect(db.tables.notifications[1].body).toContain("$10.00");
    expect(db.tables.notifications[1].body).toContain("$35.00 refunded in total");
  });

  it("a refund of a renewal (no checkout session) is found through the invoice, whichever shape Stripe sends", async () => {
    for (const shape of ["older", "newer"] as const) {
      const db = world({ seats, profiles });
      const stripe = fakeStripe({ sessionMeta: null, shape });
      const charge = shape === "older" ? { id: "ch_9", payment_intent: "pi_9", invoice: "in_9", amount_refunded: 1000, currency: "usd" } : { id: "ch_9", payment_intent: "pi_9", amount_refunded: 1000, currency: "usd" };
      await handlePaymentProblemEvent(evt("charge.refunded", charge, "evt_3"), { db, stripe });
      expect(db.tables.payment_events[0], shape).toMatchObject({ kind: "refund", group_id: "grp", athlete_id: "ath" });
      expect(stripe.invoices.retrieve).toHaveBeenCalledWith("in_9");
    }
  });

  it("a dispute opened and a dispute closed (won or lost) are recorded against the charge's owner", async () => {
    const db = world({ seats, profiles });
    const stripe = fakeStripe({ sessionMeta: { athlete_id: "ath", group_id: "grp" } });
    await handlePaymentProblemEvent(evt("charge.dispute.created", { id: "dp_1", charge: "ch_1", amount: 2500, currency: "usd", status: "needs_response" }, "evt_4"), { db, stripe });
    await handlePaymentProblemEvent(evt("charge.dispute.closed", { id: "dp_1", charge: "ch_1", amount: 2500, currency: "usd", status: "won" }, "evt_5"), { db, stripe });
    expect(db.tables.payment_events.map((r) => [r.kind, r.stripe_object_id, r.detail])).toEqual([["dispute_opened", "dp_1", null], ["dispute_closed", "dp_1", "you won"]]);
    expect(db.tables.notifications).toHaveLength(2);
  });

  it("the same Stripe event delivered twice is recorded once and the coach is told once", async () => {
    const db = world({ seats, profiles });
    const e = evt("invoice.payment_failed", failedInvoice());
    await handlePaymentProblemEvent(e, { db, stripe: fakeStripe() });
    await handlePaymentProblemEvent(e, { db, stripe: fakeStripe() });
    expect(db.tables.payment_events).toHaveLength(1);
    expect(db.tables.notifications).toHaveLength(1);
  });

  it("a coach's own plan payment failing is recorded against the coach and only they are told", async () => {
    const db = world({ seats, profiles });
    await handlePaymentProblemEvent(evt("invoice.payment_failed", { ...failedInvoice("in_2"), amount_due: 4900 }, "evt_6"), { db, stripe: fakeStripe({ sub: { coach_id: "coach1", purchase_kind: "coach_lift_off" } }) });
    expect(db.tables.payment_events[0]).toMatchObject({ coach_id: "coach1", group_id: null, athlete_id: null });
    expect(db.tables.notifications).toHaveLength(1);
    expect(db.tables.notifications[0]).toMatchObject({ profile_id: "coach1", group_id: null, link_path: "/dashboard" });
    expect(db.tables.notifications[0].body).toContain("for your plan");
  });
});

describe("a lookup that FAILS is retried; only one that succeeds and finds nobody is recorded unattributed", () => {
  it("a failing Stripe lookup throws before anything is written, for every kind of event", async () => {
    const cases: [string, unknown, string][] = [
      ["invoice.payment_failed", failedInvoice(), "subscription"],
      ["charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 900, currency: "usd" }, "sessions"],
      ["charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 900, currency: "usd" }, "invoicePayments"],
      ["charge.refunded", { id: "ch_1", payment_intent: "pi_1", invoice: "in_9", amount_refunded: 900, currency: "usd" }, "invoice"],
      ["charge.dispute.created", { id: "dp_1", charge: "ch_1", amount: 900, currency: "usd" }, "sessions"],
    ];
    for (const [type, object, failOn] of cases) {
      const db = world({ seats, profiles });
      await expect(handlePaymentProblemEvent(evt(type, object), { db, stripe: fakeStripe({ sessionMeta: failOn === "sessions" ? undefined : null, failOn }) }), `${type} ${failOn}`).rejects.toBeTruthy();
      expect(db.tables.payment_events, `${type} ${failOn}`).toHaveLength(0);
      expect(db.tables.notifications).toHaveLength(0);
    }
  });

  it("a deleted subscription (Stripe says it is gone) is a lookup that succeeded: recorded unattributed, nobody told", async () => {
    const db = world({ seats, profiles });
    await handlePaymentProblemEvent(evt("invoice.payment_failed", failedInvoice()), { db, stripe: fakeStripe({ missingSub: true }) });
    expect(db.tables.payment_events[0]).toMatchObject({ kind: "payment_failed", group_id: null, athlete_id: null, coach_id: null });
    expect(db.tables.notifications).toHaveLength(0);
  });

  it("a charge with no checkout and no invoice is recorded unattributed", async () => {
    const db = world({ seats, profiles });
    await handlePaymentProblemEvent(evt("charge.refunded", { id: "ch_x", payment_intent: null, amount_refunded: 700, currency: "usd" }, "evt_7"), { db, stripe: fakeStripe({ sessionMeta: null }) });
    expect(db.tables.payment_events[0]).toMatchObject({ kind: "refund", group_id: null, athlete_id: null, coach_id: null, amount_cents: 700 });
    expect(db.tables.notifications).toHaveLength(0);
  });

  it("if the record cannot be written the event is thrown back so Stripe sends it again, and nobody is told", async () => {
    const db = world({ seats, profiles, failInsert: true });
    await expect(handlePaymentProblemEvent(evt("invoice.payment_failed", failedInvoice()), { db, stripe: fakeStripe() })).rejects.toBeTruthy();
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

  it("the migration records and reports only: group coaches and the organization's admins read, nothing is written from a browser, the report is for a platform admin", () => {
    const sql = src("supabase/migrations/0409_payment_events.sql");
    expect(sql).toContain("revoke all on public.payment_events from anon, authenticated;\ngrant select on public.payment_events to authenticated;");
    expect(sql).toContain("stripe_event_id text not null unique");
    expect(sql).toContain("public.is_org_admin_of_group(group_id)");
    expect(sql).toContain("(group_id is null and coach_id = (select auth.uid()))");
    expect(sql).toContain("is_platform_admin");
    expect(sql).toContain("s.status in ('active', 'past_due', 'paused')");
    expect(sql).toContain("e.subscription_id = s.stripe_subscription_id");
    expect(sql).not.toMatch(/update public\.(session_credits|membership_subscriptions|credit_purchases)|delete from/);
  });

  it("the coach sees them on the Business page across the groups its numbers cover, the section says when it could not load or is capped, and the platform admin has a checks page", () => {
    expect(src("app/(coach)/groups/[groupId]/business/page.tsx")).toContain("<PaymentProblemsSection groupIds={groupIds}");
    const section = src("components/coach/payment-problems-section.tsx");
    expect(section).toContain('.from("payment_events")');
    expect(section).toContain("Couldn&apos;t load payment problems");
    expect(section).toContain("Showing the latest");
    expect(section).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    const admin = src("app/admin/payments/page.tsx");
    expect(admin).toContain('rpc("payment_reconciliation_report")');
    expect(admin).toContain("is_platform_admin");
  });
});
