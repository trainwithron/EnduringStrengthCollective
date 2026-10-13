import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeReadinessAverage, isLowReadiness, sorenessShown, sorenessStored } from "@/lib/wellness";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the soreness scale reads 1 = Fresh ... 5 = Very sore, and nothing stored changes meaning", () => {
  it("flips only between what is shown and what is stored", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(sorenessStored(sorenessShown(n))).toBe(n);
    }
    expect(sorenessShown(5)).toBe(1); // stored 5 (fresh) is shown as 1 (Fresh)
    expect(sorenessShown(1)).toBe(5); // stored 1 (very sore) is shown as 5 (Very sore)
    expect(sorenessStored(5)).toBe(1); // a client who taps 5 (Very sore) stores 1
  });
  it("the readiness rules still read the stored convention (a very sore day lowers readiness)", () => {
    const verySoreTapped = { sleepQuality: 3, soreness: sorenessStored(5), energy: 3 };
    const freshTapped = { sleepQuality: 3, soreness: sorenessStored(1), energy: 3 };
    expect(computeReadinessAverage(freshTapped)).toBeGreaterThan(computeReadinessAverage(verySoreTapped));
    expect(isLowReadiness({ sleepQuality: 2, soreness: sorenessStored(5), energy: 2 })).toBe(true);
    expect(isLowReadiness({ sleepQuality: 3, soreness: sorenessStored(1), energy: 3 })).toBe(false);
  });
  it("the card shows Fresh on the left and Very sore on the right, and Sleep quality and Energy are unchanged", () => {
    const w = read("components/athlete/wellness-checkin-widget.tsx");
    expect(w).toContain('{ key: "soreness", label: "Soreness", lowLabel: "Fresh", highLabel: "Very sore", flipped: true },');
    expect(w).toContain('{ key: "sleepQuality", label: "Sleep quality", lowLabel: "Poor", highLabel: "Great" },');
    expect(w).toContain('{ key: "energy", label: "Energy", lowLabel: "Low", highLabel: "High" },');
    expect(w).toContain("soreness: values.soreness,"); // the stored value is saved as is
  });
  it("the coach's trend chart is shown on the same scale as the card", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain("value: sorenessShown(r.soreness)");
    expect(page).toContain("Soreness (higher = more sore)");
  });
});
