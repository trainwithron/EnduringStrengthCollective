import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("every session costs exactly 1 credit (Release AA)", () => {
  it("no screen asks for, shows or sends a session type's credit cost any more", () => {
    for (const f of [
      "components/coach/desktop/session-type-manager.tsx",
      "components/logging/start-workout-button.tsx",
      "components/logging/workout-overview-view.tsx",
      "lib/session-type-presets.ts",
      "app/(coach)/groups/[groupId]/business/session-types/page.tsx",
      "app/(coach)/groups/[groupId]/athletes/[athleteId]/log/[workoutId]/page.tsx",
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/creditCost|credit_cost|Credit cost/);
    }
    expect(read("components/logging/start-workout-button.tsx")).toContain("Use 1 session credit");
    expect(read("components/coach/desktop/session-type-manager.tsx")).toContain("exactly 1 credit");
  });
  it("the database function and the rule (migration 0329) take exactly 1 and keep the column", () => {
    const sql = read("supabase/migrations/0329_release_aa_credit_one_and_waitlist_zone.sql");
    expect(sql).toContain("check (credit_cost = 1)");
    expect(sql).toContain("v_credit_cost := 1;");
    expect(sql).not.toMatch(/select\s+credit_cost\s+into/);
    expect(sql).not.toMatch(/drop column/);
  });
  it("the waitlist offer uses the coach's zone and its code is plain ASCII (the dash is chr(8212))", () => {
    const sql = read("supabase/migrations/0329_release_aa_credit_one_and_waitlist_zone.sql");
    expect(sql).toContain("to_char(p_start_at at time zone v_zone, 'Dy Mon DD, HH12:MI AM')");
    expect(sql).toContain("chr(8212)");
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(/[^\x00-\x7F]/.test(code)).toBe(false);
  });
});
