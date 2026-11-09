import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// A small stand-in for the database: each table returns its one row (or an error); writes are remembered.
type Row = Record<string, unknown> | null;
let tables: Record<string, { data?: Row; error?: { code?: string; message: string } | null }>;
let writes: { table: string; op: string; values: unknown }[];
let rpcs: string[];
function chain(table: string) {
  const result = () => ({ data: tables[table]?.data ?? null, error: tables[table]?.error ?? null, count: 0 });
  const c: any = {
    select: () => c,
    eq: () => c,
    neq: () => c,
    limit: () => c,
    maybeSingle: async () => result(),
    single: async () => result(),
    insert: (values: unknown) => { writes.push({ table, op: "insert", values }); return Object.assign(Promise.resolve({ error: null }), c); },
    update: (values: unknown) => { writes.push({ table, op: "update", values }); return Object.assign(Promise.resolve({ error: null }), c); },
    upsert: (values: unknown) => { writes.push({ table, op: "upsert", values }); return Promise.resolve({ error: null }); },
    then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok),
  };
  return c;
}
const db = {
  from: (t: string) => chain(t),
  rpc: async (name: string) => { rpcs.push(name); return { data: true, error: null }; },
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }), admin: { getUserById: async () => ({ data: { user: { email: "c@example.com" } } }) } },
};

const stripeMock = {
  webhooks: { constructEvent: vi.fn() },
  checkout: { sessions: { create: vi.fn(async () => ({ url: "https://stripe.test/s" })) } },
  customers: { create: vi.fn(async () => ({ id: "cus_new" })) },
  products: { create: vi.fn(async () => ({ id: "prod_new" })) },
  prices: { create: vi.fn(async () => ({ id: "price_new" })) },
  subscriptions: { retrieve: vi.fn() },
};
const connectedClientFor = vi.fn((_account: string) => stripeMock);

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => db }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => db }));
vi.mock("@/lib/stripe", () => ({ isStripeConfigured: () => true, getStripeClient: () => stripeMock, getConnectedStripeClient: (a: string) => connectedClientFor(a) }));
vi.mock("@/lib/notify-payment", () => ({ notifyPaymentReceived: vi.fn() }));
vi.mock("@/lib/webhook-dispatch", () => ({ dispatchWebhookEvent: vi.fn() }));
vi.mock("@/lib/program-duplication", () => ({ duplicateProgram: vi.fn() }));
vi.mock("@/lib/package-group-access", () => ({ grantLinkedGroupAccess: vi.fn(async () => ({})), revokeLinkedGroupAccess: vi.fn() }));
vi.mock("@/lib/ai-topup", () => ({ recordAiTopUp: vi.fn() }));
vi.mock("@/lib/payment-events", () => ({ handlePaymentProblemEvent: vi.fn() }));

const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const pkg = { id: "p1", coach_id: "c1", group_id: "g1", name: "Pack", billing_type: "one_time", sessions_granted: 10, rate_cents: 10000, price_cents: null, stripe_price_id: null, is_active: true };
const notReady = { group_memberships: { data: { role: "athlete", membership_type: "training" } }, coach_packages: { data: pkg }, groups: { data: { organization_id: "o1" } }, org_connect_accounts: { data: { stripe_account_id: "acct_1", status: "pending" } } };
const ready = { ...notReady, org_connect_accounts: { data: { stripe_account_id: "acct_1", status: "ready" } }, organization_billing: { data: { billing_exempt: false, subscription_status: "active" } }, organizations: { data: { created_at: "2026-01-01T00:00:00Z" } }, stripe_connected_customers: { data: null } };

beforeEach(() => {
  writes = [];
  rpcs = [];
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_platform";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_connect";
});

describe("no client payment is ever transferred or routed through the platform", () => {
  const root = join(__dirname, "..");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []; });
  it("no code calls stripe.transfers or creates a destination charge", () => {
    for (const file of [...walk(join(root, "app")), ...walk(join(root, "lib")), ...walk(join(root, "components"))]) {
      const code = readFileSync(file, "utf8");
      expect(code, relative(root, file)).not.toMatch(/\.transfers\.|transfer_data|on_behalf_of|transfer_group/);
    }
  });
});

describe("the payee has to be ready", () => {
  it("package checkout refuses in plain words and charges nothing", async () => {
    tables = notReady;
    const { POST } = await import("@/app/api/stripe/checkout/route");
    const res = await POST(post({ packageId: "p1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("isn't set up to take payments");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("Quick Payment refuses in plain words and charges nothing", async () => {
    tables = { ...notReady, group_memberships: { data: { role: "coach" } }, org_connect_accounts: { data: null } };
    let calls = 0;
    const athlete = { data: { role: "athlete" } };
    const coach = { data: { role: "coach" } };
    tables = new Proxy(tables, { get: (t, k: string) => (k === "group_memberships" ? (calls++ === 0 ? coach : athlete) : (t as any)[k]) });
    const { POST } = await import("@/app/api/stripe/quick-payment-checkout/route");
    const res = await POST(post({ groupId: "g1", athleteId: "a1", amountCents: 5000 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Connect Stripe");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("a ready payee gets a direct charge with the fee, its own price and its own customer", async () => {
    tables = ready;
    const { POST } = await import("@/app/api/stripe/checkout/route");
    const res = await POST(post({ packageId: "p1" }));
    expect(res.status).toBe(200);
    const [params, options] = stripeMock.checkout.sessions.create.mock.calls[0] as unknown as [any, any];
    expect(options).toEqual({ stripeAccount: "acct_1" });
    expect(params.payment_intent_data.application_fee_amount).toBe(1000); // 1% of 10 x $100
    expect(params.customer).toBe("cus_new");
    expect(params.line_items[0].price).toBe("price_new");
    expect((stripeMock.prices.create.mock.calls[0] as unknown as unknown[])[1]).toEqual({ stripeAccount: "acct_1" });
    expect(writes.some((w) => w.table === "stripe_customers")).toBe(false);
  });
});

describe("the webhook", () => {
  const event = (over: Record<string, unknown>) => ({ id: "evt_1", created: 1, type: "checkout.session.completed", ...over });
  const paidSession = (metadata: Record<string, string>) => ({ object: { id: "cs_1", mode: "payment", payment_status: "paid", amount_total: 1000, metadata } });
  const call = async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    return POST(new Request("http://localhost/x", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" }));
  };
  const purchase = { athlete_id: "a1", group_id: "g1", coach_package_id: "p1", credits: "5" };

  it("accepts a signature from either secret", async () => {
    const { constructEventFromSecrets } = await import("@/lib/connect-payee");
    const fake: any = { webhooks: { constructEvent: (_b: string, _s: string, secret: string) => { if (secret !== "two") throw new Error("bad"); return { id: "evt" }; } } };
    expect(constructEventFromSecrets(fake, "b", "s", ["one", "two"]).id).toBe("evt");
    expect(() => constructEventFromSecrets(fake, "b", "s", ["one"])).toThrow("bad");
  });
  it("rejects a bad signature", async () => {
    tables = ready;
    stripeMock.webhooks.constructEvent.mockImplementation(() => { throw new Error("nope"); });
    expect((await call()).status).toBe(400);
  });
  it("grants a purchase from the group's own connected account, reading on that account", async () => {
    tables = ready;
    stripeMock.webhooks.constructEvent.mockReturnValue(event({ account: "acct_1", data: paidSession(purchase) }));
    expect((await call()).status).toBe(200);
    expect(connectedClientFor).toHaveBeenCalledWith("acct_1");
    expect(rpcs).toContain("grant_purchase_once");
  });
  it("ignores a purchase from any other connected account", async () => {
    tables = ready;
    stripeMock.webhooks.constructEvent.mockReturnValue(event({ account: "acct_other", data: paidSession(purchase) }));
    expect((await call()).status).toBe(200);
    expect(rpcs).not.toContain("grant_purchase_once");
  });
  it("still grants a purchase on the platform's own account (a payment from before direct charges)", async () => {
    tables = ready;
    stripeMock.webhooks.constructEvent.mockReturnValue(event({ data: paidSession(purchase) }));
    expect((await call()).status).toBe(200);
    expect(connectedClientFor).not.toHaveBeenCalled();
    expect(rpcs).toContain("grant_purchase_once");
  });
  it("a coach's plan purchase counts only on the platform's account", async () => {
    tables = ready;
    const pack = { purchase_kind: "coach_credit_pack", coach_id: "c1", credits: "5" };
    stripeMock.webhooks.constructEvent.mockReturnValue(event({ account: "acct_1", data: paidSession(pack) }));
    await call();
    expect(rpcs).not.toContain("grant_coach_credit_pack_once");
    stripeMock.webhooks.constructEvent.mockReturnValue(event({ data: paidSession(pack) }));
    await call();
    expect(rpcs).toContain("grant_coach_credit_pack_once");
  });
  it("account.updated marks the organization ready", async () => {
    tables = ready;
    stripeMock.webhooks.constructEvent.mockReturnValue(event({ type: "account.updated", account: "acct_1", data: { object: { id: "acct_1", details_submitted: true, charges_enabled: true } } }));
    await call();
    expect(writes.find((w) => w.table === "org_connect_accounts" && w.op === "update")?.values).toMatchObject({ status: "ready" });
  });
});
