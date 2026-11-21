import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addMonths, durationWords, retentionSummary, tenureEnd, type TenureRow } from "@/lib/client-retention";

const now = new Date("2026-11-20T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const row = (joinedDaysAgo: number, lastDaysAgo: number | null, removedDaysAgo: number | null = null, id = "a"): TenureRow => ({ athlete_id: id, group_id: "g", joined_at: ago(joinedDaysAgo), removed_at: removedDaysAgo == null ? null : ago(removedDaysAgo), last_active: lastDaysAgo == null ? null : ago(lastDaysAgo) });

describe("time with you", () => {
  it("still active (a workout or session in the last 30 days, or signed up within them): up to now", () => {
    expect(tenureEnd(row(400, 3), now)).toEqual(now);
    expect(tenureEnd(row(10, null), now)).toEqual(now);
  });
  it("stopped: up to their last active day; never active: no time; removed: never past the removal", () => {
    expect(tenureEnd(row(400, 100), now)?.toISOString()).toBe(ago(100));
    expect(tenureEnd(row(400, null), now)?.toISOString()).toBe(ago(400));
    expect(tenureEnd(row(400, 5, 50), now)?.toISOString()).toBe(ago(50));
    expect(tenureEnd(row(400, 80, 50), now)?.toISOString()).toBe(ago(80));
    expect(tenureEnd({ ...row(1, 1), joined_at: null }, now)).toBeNull();
  });
});

describe("the summary", () => {
  const rows = [
    row(400, 2, null, "a"), // 400 days, still active
    row(300, 120, null, "b"), // stopped at 180 days in
    row(200, null, 150, "c"), // removed, never active: 0 days
    row(20, null, null, "d"), // new: 20 days, still active
  ];
  it("average time with you, and how many are still active", () => {
    const s = retentionSummary(rows, now);
    expect(s.clients).toBe(4);
    expect(s.stillActive).toBe(2);
    expect(s.averageDays).toBe(Math.round((400 + 180 + 0 + 20) / 4));
  });
  it("still active after 3, 6 and 12 months: only clients who signed up that long ago count", () => {
    const s = retentionSummary(rows, now);
    expect(s.after).toEqual([
      { months: 3, signedUpLongEnough: 3, stillActive: 2, pct: 67 },
      { months: 6, signedUpLongEnough: 3, stillActive: 1, pct: 33 },
      { months: 12, signedUpLongEnough: 1, stillActive: 1, pct: 100 },
    ]);
  });
  it("the period picks which sign-ups count; no one yet reads as not yet", () => {
    const s = retentionSummary(rows, now, "12m");
    expect(s.clients).toBe(3);
    expect(s.after[2]).toMatchObject({ months: 12, signedUpLongEnough: 0, pct: null });
    expect(retentionSummary([], now)).toMatchObject({ clients: 0, averageDays: null });
  });
});

describe("words and months", () => {
  it("calendar months, the end of a short month held", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonths(new Date("2026-11-20T12:00:00Z"), -12).toISOString()).toBe("2025-11-20T12:00:00.000Z");
  });
  it("a duration in plain words", () => {
    expect(durationWords(1)).toBe("1 day");
    expect(durationWords(12)).toBe("12 days");
    expect(durationWords(120)).toBe("4 months");
    expect(durationWords(365)).toBe("1 year");
    expect(durationWords(430)).toBe("1 year 2 months");
  });
});

describe("on the Business page", () => {
  it("one read of dates only, left off when it fails (before step 219)", () => {
    const p = readFileSync("app/(coach)/groups/[groupId]/business/page.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(p).toContain('supabase.rpc("business_client_tenure", { p_group_ids: groupIds })');
    expect(p).toContain("const tenureRows = tenure.failed ? null");
    expect(p).toContain("{tenureRows && (");
  });
});
