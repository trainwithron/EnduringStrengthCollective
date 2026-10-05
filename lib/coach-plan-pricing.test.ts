import { describe, expect, it } from "vitest";
import { computePlanQuote, formatPlanCents, MAX_AUTO_CLIENTS } from "@/lib/coach-plan-pricing";

const base = { coachSeats: 1, orgAddon: false };

describe("computePlanQuote", () => {
  it("prices the settled step boundaries (1-100 = $50 ... 301-400 = $125)", () => {
    expect(computePlanQuote({ ...base, clients: 0 }).totalCents).toBe(5000);
    expect(computePlanQuote({ ...base, clients: 1 }).totalCents).toBe(5000);
    expect(computePlanQuote({ ...base, clients: 100 }).totalCents).toBe(5000);
    expect(computePlanQuote({ ...base, clients: 101 }).totalCents).toBe(7500);
    expect(computePlanQuote({ ...base, clients: 200 }).totalCents).toBe(7500);
    expect(computePlanQuote({ ...base, clients: 201 }).totalCents).toBe(10000);
    expect(computePlanQuote({ ...base, clients: 300 }).totalCents).toBe(10000);
    expect(computePlanQuote({ ...base, clients: 301 }).totalCents).toBe(12500);
    expect(computePlanQuote({ ...base, clients: 400 }).totalCents).toBe(12500);
  });

  it("stays at the 400 tier above 400 and flags the org", () => {
    const q = computePlanQuote({ ...base, clients: 650 });
    expect(MAX_AUTO_CLIENTS).toBe(400);
    expect(q.overCap).toBe(true);
    expect(q.steps).toBe(7);
    expect(q.billedSteps).toBe(4);
    expect(q.totalCents).toBe(12500);
    expect(q.clientsBeforeNextStep).toBeNull();
    expect(computePlanQuote({ ...base, clients: 400 }).overCap).toBe(false);
  });

  it("adds $15 per coach beyond the first and never charges for zero seats", () => {
    expect(computePlanQuote({ clients: 10, coachSeats: 1, orgAddon: false }).totalCents).toBe(5000);
    expect(computePlanQuote({ clients: 10, coachSeats: 4, orgAddon: false }).totalCents).toBe(5000 + 3 * 1500);
    expect(computePlanQuote({ clients: 10, coachSeats: 0, orgAddon: false }).extraSeats).toBe(0);
  });

  it("adds $50 for the organization add-on", () => {
    const q = computePlanQuote({ clients: 150, coachSeats: 3, orgAddon: true });
    // 50 base + 25 block + 30 seats + 50 add-on
    expect(q.totalCents).toBe(5000 + 2500 + 3000 + 5000);
    expect(q.lines.map((l) => l.key)).toEqual(["base", "clientBlock", "coachSeat", "orgAddon"]);
  });

  it("omits zero-quantity lines", () => {
    const q = computePlanQuote({ ...base, clients: 50 });
    expect(q.lines.map((l) => l.key)).toEqual(["base"]);
  });

  it("reports room before the next step and what the next step costs", () => {
    const q = computePlanQuote({ ...base, clients: 95 });
    expect(q.clientsBeforeNextStep).toBe(5);
    expect(q.nextStepTotalCents).toBe(7500);
    expect(computePlanQuote({ ...base, clients: 100 }).clientsBeforeNextStep).toBe(0);
    expect(computePlanQuote({ ...base, clients: 101 }).clientsBeforeNextStep).toBe(99);
  });

  it("formats cents as dollars", () => {
    expect(formatPlanCents(5000)).toBe("$50");
    expect(formatPlanCents(1550)).toBe("$15.50");
  });
});
