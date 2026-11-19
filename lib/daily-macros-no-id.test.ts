import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// daily_macros has no id column (its key is athlete_id + log_date). The coach Nutrition page's week read asked for "id" and ordered by it, so the whole read failed live and
// every client's week showed "Couldn't load this week's numbers" (Nov 19). The mocked tests could not see it; this pins the read to real columns.
describe("coach Nutrition week read of daily_macros", () => {
  const src = readFileSync(join(__dirname, "coach-nutrition-week.ts"), "utf8");
  const line = src.split("\n").find((l) => l.includes('from("daily_macros")')) ?? "";

  it("reads daily_macros", () => {
    expect(line).not.toBe("");
  });

  it("never selects or orders by an id column daily_macros does not have", () => {
    expect(line).not.toMatch(/select\("id[,"]/);
    expect(line).not.toMatch(/\.order\("id"\)/);
  });

  it("pages in a stable order on the table's key", () => {
    expect(line).toContain('.order("athlete_id").order("log_date")');
  });
});
