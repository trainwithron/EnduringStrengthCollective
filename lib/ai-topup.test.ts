import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/send-push", () => ({ sendPushToProfile: async () => 1 }));
vi.mock("@/lib/stripe", () => ({ isStripeConfigured: () => true }));

import { recordAiTopUp } from "@/lib/ai-topup";

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

describe("recordAiTopUp", () => {
  it("adds the dollars of the pack that was paid, to the month of the event", async () => {
    const { db, rows } = fakeDb();
    const r = await recordAiTopUp(db, { eventId: "evt_1", organizationId: "org1", amountPaidCents: 500, eventCreatedSeconds: Date.UTC(2026, 9, 20) / 1000 });
    expect(r).toBe("added");
    expect(rows[0]).toMatchObject({ organization_id: "org1", month: "2026-10-01", usd_added: 3.5, pack_cents: 500, stripe_event_id: "evt_1" });
    const r2 = await recordAiTopUp(db, { eventId: "evt_2", organizationId: "org1", amountPaidCents: 1000, eventCreatedSeconds: Date.UTC(2026, 10, 1, 0, 0, 5) / 1000 });
    expect(r2).toBe("added");
    expect(rows[1]).toMatchObject({ month: "2026-11-01", usd_added: 7 });
  });
  it("the same event sent twice adds the money once", async () => {
    const seen = new Set<string>();
    const first = fakeDb(seen);
    expect(await recordAiTopUp(first.db, { eventId: "evt_9", organizationId: "o", amountPaidCents: 500 })).toBe("added");
    const again = fakeDb(seen);
    expect(await recordAiTopUp(again.db, { eventId: "evt_9", organizationId: "o", amountPaidCents: 500 })).toBe("duplicate");
    expect(first.rows).toHaveLength(1);
    expect(again.rows).toHaveLength(0);
  });
  it("a payment that matches no pack, or has no organization, adds nothing", async () => {
    const { db, rows } = fakeDb();
    expect(await recordAiTopUp(db, { eventId: "a", organizationId: "o", amountPaidCents: 750 })).toBe("ignored");
    expect(await recordAiTopUp(db, { eventId: "b", organizationId: "o", amountPaidCents: 100000 })).toBe("ignored");
    expect(await recordAiTopUp(db, { eventId: "c", organizationId: "", amountPaidCents: 500 })).toBe("ignored");
    expect(await recordAiTopUp(db, { eventId: "d", organizationId: "o", amountPaidCents: null })).toBe("ignored");
    expect(rows).toHaveLength(0);
  });
  it("any other database failure is raised so Stripe retries the event", async () => {
    const db = { from: () => ({ insert: async () => ({ error: { code: "08006", message: "connection" } }) }) } as never;
    await expect(recordAiTopUp(db, { eventId: "e", organizationId: "o", amountPaidCents: 500 })).rejects.toBeTruthy();
  });
});
