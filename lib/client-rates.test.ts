import { describe, expect, it } from "vitest";
import { ratesByMembership } from "@/lib/client-rates";
import { computeEstimatedMRR } from "@/lib/business-metrics";

describe("ratesByMembership", () => {
  it("maps each membership to its rate, whether the database sent a number or text", () => {
    const m = ratesByMembership([
      { membership_id: "a", monthly_rate: 150 },
      { membership_id: "b", monthly_rate: "99.5" },
    ]);
    expect(m.get("a")).toBe(150);
    expect(m.get("b")).toBe(99.5);
  });
  it("a failed read (the table is not there yet) or no rows gives an empty map, so the roster still shows", () => {
    expect(ratesByMembership(null).size).toBe(0);
    expect(ratesByMembership(undefined).size).toBe(0);
    expect(ratesByMembership([]).size).toBe(0);
  });
  it("leaves out rows with no usable number", () => {
    const m = ratesByMembership([
      { membership_id: "a", monthly_rate: null },
      { membership_id: "b", monthly_rate: "" },
      { membership_id: "c", monthly_rate: "abc" },
      { membership_id: "d", monthly_rate: -5 },
      { membership_id: "e", monthly_rate: 0 },
    ]);
    expect([...m.keys()]).toEqual(["e"]);
  });
  it("the Business estimate is simply zero while the rates are missing, never an error", () => {
    const rates = ratesByMembership(null);
    const roster = [{ id: "a" }, { id: "b" }];
    expect(computeEstimatedMRR(roster.map((r) => ({ monthlyRate: rates.get(r.id) ?? null })))).toBe(0);
  });
});
