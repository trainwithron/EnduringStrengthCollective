import { describe, it, expect } from "vitest";
import { dedupeRecentFoodLogs, type RecentFoodLogRow } from "./recent-food-logs";

function row(description: string, createdAt: string): RecentFoodLogRow {
  return { description, calories: 400, proteinG: 30, carbsG: 40, fatG: 10, createdAt };
}

describe("dedupeRecentFoodLogs", () => {
  it("keeps only the most recent instance of a repeated description", () => {
    const rows = [row("Chipotle bowl", "2026-09-14"), row("Chipotle bowl", "2026-09-10")];
    const result = dedupeRecentFoodLogs(rows, 10);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("Chipotle bowl");
  });

  it("treats descriptions as equal case/whitespace-insensitively", () => {
    const rows = [row("Chipotle Bowl", "2026-09-14"), row(" chipotle bowl ", "2026-09-10")];
    const result = dedupeRecentFoodLogs(rows, 10);
    expect(result).toHaveLength(1);
  });

  it("respects the limit", () => {
    const rows = ["a", "b", "c", "d"].map((d, i) => row(d, `2026-09-${10 + i}`));
    const result = dedupeRecentFoodLogs(rows, 2);
    expect(result).toHaveLength(2);
  });

  it("skips empty descriptions", () => {
    const rows = [row("", "2026-09-14"), row("real meal", "2026-09-13")];
    const result = dedupeRecentFoodLogs(rows, 10);
    expect(result).toEqual([{ description: "real meal", calories: 400, proteinG: 30, carbsG: 40, fatG: 10 }]);
  });
});
