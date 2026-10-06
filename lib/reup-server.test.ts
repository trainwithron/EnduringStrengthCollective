import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/timezone", () => ({ dateKeyInZone: () => "2026-10-05", getGroupCoachTimezone: async () => "America/New_York" }));
vi.mock("@/lib/stripe", () => ({ isStripeConfigured: () => true }));

import { loadReupState } from "./reup-server";

// A tiny stand-in for the Supabase query builder: every select resolves to the rows registered for that table.
function fake(tables: Record<string, any>, opts: { holdColumnMissing?: boolean } = {}) {
  return {
    from(table: string) {
      let selected = "";
      const builder: any = {
        select(cols: string) { selected = cols; return builder; },
        eq() { return builder; }, not() { return builder; }, order() { return builder; }, limit() { return builder; }, gte() { return builder; }, lte() { return builder; }, in() { return builder; },
        maybeSingle: async () => {
          if (table === "session_credits" && opts.holdColumnMissing && selected.includes("payment_hold")) return { data: null, error: { message: "column payment_hold does not exist" } };
          return { data: tables[table] ?? null, error: null };
        },
        then(resolve: any) { resolve({ data: tables[table] ?? [], error: null }); },
      };
      return builder;
    },
  };
}

describe("loadReupState", () => {
  it("shows a re-up prompt when the balance is zero or below", async () => {
    const s = await loadReupState(fake({ session_credits: { balance: 0, payment_hold: false } }), "a", "g");
    expect(s).not.toBeNull();
  });
  it("shows nothing while the client still has sessions", async () => {
    expect(await loadReupState(fake({ session_credits: { balance: 2, payment_hold: false } }), "a", "g")).toBeNull();
  });
  it("shows nothing to a client the coach has put on hold (billed another way)", async () => {
    expect(await loadReupState(fake({ session_credits: { balance: 0, payment_hold: true } }), "a", "g")).toBeNull();
    expect(await loadReupState(fake({ session_credits: { balance: -3, payment_hold: true } }), "a", "g")).toBeNull();
  });
  it("still works before the hold column exists", async () => {
    expect(await loadReupState(fake({ session_credits: { balance: 0 } }, { holdColumnMissing: true }), "a", "g")).not.toBeNull();
  });
  it("shows nothing for someone never put on sessions", async () => {
    expect(await loadReupState(fake({}), "a", "g")).toBeNull();
  });
});
