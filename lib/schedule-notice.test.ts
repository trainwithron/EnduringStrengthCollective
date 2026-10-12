import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("a coach can ask for notice before a weekly schedule is paused or ended", () => {
  it("the database refuses a sooner date and says the earliest day in plain words; the default is no notice", () => {
    const sql = read("supabase/migrations/0353_schedule_change_notice.sql");
    expect(sql).toContain("schedule_change_notice_days smallint not null default 0");
    expect(sql).toContain("your coach asks for % days notice: the earliest date is %");
  });
  it("the coach sets it on Availability, with optional words of their own", () => {
    expect(read("app/(coach)/groups/[groupId]/availability/page.tsx")).toContain("<ScheduleNoticeControl");
    const control = read("components/coach/desktop/schedule-notice-control.tsx");
    expect(control).toContain("schedule_change_notice_days");
    expect(control).toContain("Your words for the client (optional)");
  });
  it("the client's request sheet starts at the earliest allowed day and shows the coach's words", () => {
    const sheet = read("components/athlete/my-schedule.tsx");
    expect(sheet).toContain("min={earliest}");
    expect(sheet).toContain("series.noticeText?.trim()");
    expect(read("lib/my-schedule-data.ts")).toContain("schedule_change_notice_days");
  });
});
