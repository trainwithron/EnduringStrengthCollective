import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("the hours editor shows the three numbers together", () => {
  const src = read("./availability-manager-desktop.tsx");
  it("slot step, session length and the gap are unmistakably separate, labelled fields with a live preview and a warning", () => {
    expect(src).toContain("Slot every (min)");
    expect(src).toContain("Session length (min)");
    expect(src).toContain("Gap between sessions (min)");
    expect(src).toContain("How often a start time is offered");
    expect(src).toContain("How long the session lasts");
    expect(src).toContain("previewSessionTimes(");
    expect(src).toContain("timingWarning(");
    expect(src).toContain("timingHint(");
  });
  it("the same block is in the add form and in the edit row, so the gap is where hours are edited", () => {
    expect((src.match(/<WindowTimingFields/g) ?? []).length).toBe(2);
  });
  it("the gap is the coach's buffer: saved at once to the same setting as Booking rules, and the two fields stay in step", () => {
    expect(src).toContain('from("coach_booking_policies").upsert({ coach_id: coachId, buffer_minutes: n }');
    expect(read("../../../app/groups/[groupId]/availability/page.tsx")).toContain("key={`policy-${policyRow?.buffer_minutes ?? 0}`}");
    expect(read("../../../app/groups/[groupId]/availability/page.tsx")).toContain("initialBufferMinutes={policyRow?.buffer_minutes ?? 0}");
  });
  it("a warning never stops the coach from saving", () => {
    expect(src).not.toMatch(/timingWarning\([^)]*\)[^;]*disabled/);
    expect(read("../../../lib/availability-edit.ts")).toContain("never a block");
  });
  it("the Calendar page's Availability tab shows the same three numbers", () => {
    expect(read("./calendar-page-tabs.tsx")).toContain("initialBufferMinutes={initialBufferMinutes}");
    expect(read("../../../app/groups/[groupId]/calendar/page.tsx")).toContain("initialBufferMinutes={gapPolicy?.buffer_minutes ?? 0}");
  });
});
