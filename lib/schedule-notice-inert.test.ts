import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

describe("the schedule notice setting has no screen (Ron: not needed)", () => {
  it("the migration is still there and does nothing at the default of no notice", () => {
    const sql = read("supabase/migrations/0353_schedule_change_notice.sql");
    expect(sql).toContain("schedule_change_notice_days smallint not null default 0");
    expect(sql).toContain("if v_notice > 0 and p_effective_on < v_today + v_notice then");
  });
  it("no coach screen sets it and the client sheet does not read it", () => {
    expect(existsSync(join(root, "components/coach/desktop/schedule-notice-control.tsx"))).toBe(false);
    expect(read("components/athlete/my-schedule.tsx")).not.toContain("noticeDays");
    expect(read("lib/my-schedule-data.ts")).not.toContain("schedule_change_notice_days");
  });
});
