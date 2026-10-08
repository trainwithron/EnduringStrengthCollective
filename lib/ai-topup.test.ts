import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/send-push", () => ({ sendPushToProfile: async () => 1 }));
vi.mock("@/lib/stripe", () => ({ isStripeConfigured: () => true }));

import { recordAiTopUp, type AiTopUpInput } from "@/lib/ai-topup";

function fakeDb(seen: Set<string> = new Set()) {
  const rows: Record<string, unknown>[] = [];
  const db = {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table !== "ai_budget_topups") throw new Error("wrong table " + table);
        if (seen.has(row.stripe_event_id as string)) return { error: { code: "23505", message: "duplicate key" } };
        seen.add(row.stripe_event_id as string);
        rows.push(row);
        return { error: null };
      },
    }),
  };
  return { db: db as never, rows };
}

const base = (over: Partial<AiTopUpInput> = {}): AiTopUpInput => ({
  eventId: "evt_1",
  sessionId: "cs_1",
  organizationId: "org1",
  subtotalCents: 500,
  currency: "usd",
  metadataPackCents: "500",
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("recordAiTopUp", () => {
  it("adds the dollars of the pack that was bought, to the month of the event", async () => {
    const { db, rows } = fakeDb();
    expect(await recordAiTopUp(db, base({ eventCreatedSeconds: Date.UTC(2026, 9, 20) / 1000 }))).toBe("added");
    expect(rows[0]).toMatchObject({ organization_id: "org1", month: "2026-10-01", usd_added: 3.5, pack_cents: 500, stripe_event_id: "evt_1" });
    expect(await recordAiTopUp(db, base({ eventId: "evt_2", subtotalCents: 1000, metadataPackCents: "1000", eventCreatedSeconds: Date.UTC(2026, 10, 1, 0, 0, 5) / 1000 }))).toBe("added");
    expect(rows[1]).toMatchObject({ month: "2026-11-01", usd_added: 7 });
  });
  it("tax on top of the pack, or a discount code, does not stop the top-up from being credited (it matches the price before tax and discounts)", async () => {
    const { db, rows } = fakeDb();
    // the session total would be 540 with tax or 400 with a discount, but the subtotal is still the pack's 500
    expect(await recordAiTopUp(db, base({ eventId: "evt_tax" }))).toBe("added");
    expect(await recordAiTopUp(db, base({ eventId: "evt_disc" }))).toBe("added");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.usd_added === 3.5)).toBe(true);
  });
  it("the same event sent twice adds the money once", async () => {
    const seen = new Set<string>();
    const first = fakeDb(seen);
    expect(await recordAiTopUp(first.db, base({ eventId: "evt_9" }))).toBe("added");
    const again = fakeDb(seen);
    expect(await recordAiTopUp(again.db, base({ eventId: "evt_9" }))).toBe("duplicate");
    expect(first.rows).toHaveLength(1);
    expect(again.rows).toHaveLength(0);
  });
  it("a wrong currency, an unknown price, a missing organization, or a pack that disagrees with the metadata adds nothing and is logged loudly with the event id", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, rows } = fakeDb();
    expect(await recordAiTopUp(db, base({ eventId: "e_eur", currency: "eur" }))).toBe("ignored");
    expect(await recordAiTopUp(db, base({ eventId: "e_750", subtotalCents: 750, metadataPackCents: "750" }))).toBe("ignored");
    expect(await recordAiTopUp(db, base({ eventId: "e_big", subtotalCents: 100000, metadataPackCents: "100000" }))).toBe("ignored");
    expect(await recordAiTopUp(db, base({ eventId: "e_org", organizationId: "" }))).toBe("ignored");
    expect(await recordAiTopUp(db, base({ eventId: "e_null", subtotalCents: null }))).toBe("ignored");
    expect(await recordAiTopUp(db, base({ eventId: "e_meta", subtotalCents: 500, metadataPackCents: "1000" }))).toBe("ignored");
    expect(await recordAiTopUp(db, base({ eventId: "e_nometa", metadataPackCents: undefined }))).toBe("ignored");
    expect(rows).toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(7);
    expect(String(spy.mock.calls[0][0])).toContain("e_eur");
    expect(String(spy.mock.calls[0][0])).toContain("NOT CREDITED");
  });
  it("any other database failure is raised so Stripe retries the event", async () => {
    const db = { from: () => ({ insert: async () => ({ error: { code: "08006", message: "connection" } }) }) } as never;
    await expect(recordAiTopUp(db, base({ eventId: "e" }))).rejects.toBeTruthy();
  });
});
