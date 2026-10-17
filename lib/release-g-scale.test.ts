import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readByIds, readRowsByIds, countByIds } from "@/lib/read-by-ids";
import { runPool } from "@/lib/run-pool";
import { addDaysToKey, daysAgoKeyInZone, dateKeyInZone } from "@/lib/timezone";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
function walk(d: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, d))) {
    if (f === "node_modules" || f === ".next") continue;
    const rel = d + "/" + f;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(rel);
  }
  return out;
}

// A fake table of N rows read the way the app reads: a range of an id list, the cap of 1,000 rows a request.
function fakeTable(rowsByGroup: Record<string, number>, opts: { failOn?: string } = {}) {
  const calls: { ids: string[]; from: number; to: number }[] = [];
  const make = (ids: string[]) => async (from: number, to: number) => {
    calls.push({ ids, from, to });
    if (opts.failOn && ids.includes(opts.failOn)) return { data: null, error: { message: "boom" } };
    const all = ids.flatMap((id) => Array.from({ length: rowsByGroup[id] ?? 0 }, (_, i) => ({ id: `${id}-${i}`, group_id: id })));
    return { data: all.slice(from, Math.min(to, from + 999) + 1), error: null };
  };
  return { make, calls };
}

describe("reads over many ids go in groups and pages (a coach with 1,500 clients has 1,500 groups)", () => {
  it("1,500 ids are asked for 100 at a time, never all in one request", async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `g${i}`);
    const t = fakeTable(Object.fromEntries(ids.map((id) => [id, 1])));
    const r = await readByIds(ids, t.make);
    expect(r.rows).toHaveLength(1500);
    expect(r.failed).toBe(false);
    expect(Math.max(...t.calls.map((c) => c.ids.length))).toBe(100);
    expect(new Set(t.calls.map((c) => c.ids[0])).size).toBe(15);
  });
  it("a group with more than 1,000 rows is read a page at a time", async () => {
    const t = fakeTable({ big: 2500 });
    const r = await readByIds(["big"], t.make);
    expect(r.rows).toHaveLength(2500);
    expect(r.truncated).toBe(false);
  });
  it("a failed group is reported, never read as 'no rows', and the others still come back", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `g${i}`);
    const t = fakeTable(Object.fromEntries(ids.map((id) => [id, 1])), { failOn: "g150" });
    const r = await readByIds(ids, t.make);
    expect(r.failed).toBe(true);
    expect(r.rows.length).toBeGreaterThan(0);
    const shaped = await readRowsByIds(ids, t.make);
    expect(shaped.error).not.toBeNull();
  });
  it("the same id twice is asked once, and no ids means no request", async () => {
    const t = fakeTable({ a: 1 });
    expect((await readByIds(["a", "a", "a"], t.make)).rows).toHaveLength(1);
    const none = fakeTable({});
    expect((await readByIds([], none.make)).rows).toHaveLength(0);
    expect(none.calls).toHaveLength(0);
  });
  it("a count over many ids is added up, and a failed group is reported", async () => {
    const ids = Array.from({ length: 230 }, (_, i) => `g${i}`);
    const ok = await countByIds(ids, async (g) => ({ count: g.length, error: null }));
    expect(ok).toEqual({ count: 230, failed: false });
    const bad = await countByIds(ids, async (g) => (g.includes("g150") ? { count: null, error: { message: "x" } } : { count: g.length, error: null }));
    expect(bad.failed).toBe(true);
    expect(bad.count).toBe(130);
  });
  it("a first-N read takes N from each group of ids (the caller merges and cuts)", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `g${i}`);
    const t = fakeTable(Object.fromEntries(ids.map((id) => [id, 50])));
    const r = await readByIds(ids, t.make, { pageSize: 10, maxPages: 1 });
    // 3 groups of ids, each asked for rows 0..9 only
    expect(t.calls.every((c) => c.from === 0 && c.to === 9)).toBe(true);
    expect(r.rows).toHaveLength(30);
  });
});

describe("a long list of people is run a few at a time, inside a time budget", () => {
  it("never runs more than the limit at once and does every item", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    const out = await runPool(Array.from({ length: 20 }, (_, i) => i), 4, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      done.push(n);
      running--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(done).toHaveLength(20);
    expect(out.notStarted).toEqual([]);
    expect(out.failed).toEqual([]);
  });
  it("one that throws does not stop the rest, and nothing new starts past the deadline", async () => {
    const out = await runPool([1, 2, 3, 4], 1, async (n) => {
      if (n === 2) throw new Error("x");
    });
    expect(out.failed.map((f) => f.item)).toEqual([2]);
    let clock = 0;
    const late = await runPool([1, 2, 3, 4, 5], 1, async () => {
      clock += 100;
    }, { deadlineMs: 250, now: () => clock });
    expect(late.notStarted.length).toBeGreaterThan(0);
  });
});

describe("a coach's day is the coach's own day", () => {
  it("days are added to a key without the machine clock", () => {
    expect(addDaysToKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToKey("2028-03-01", -1)).toBe("2028-02-29");
    expect(daysAgoKeyInZone("America/Los_Angeles", 7, new Date("2026-10-17T03:00:00Z"))).toBe("2026-10-09");
  });
  it("at 8 pm in Los Angeles it is already tomorrow in UTC, and the briefing and the dashboard both use the coach's day", () => {
    const evening = new Date("2026-10-17T03:00:00Z");
    expect(dateKeyInZone("America/Los_Angeles", evening)).toBe("2026-10-16");
    expect(evening.toISOString().slice(0, 10)).toBe("2026-10-17");
    const cron = src("app/api/cron/coach-briefing/route.ts");
    expect(cron).toContain("const todayKey = dateKeyInZone(timeZone);");
    const page = src("app/(coach)/dashboard/page.tsx");
    expect(page).toContain("b.briefing_date === dateKeyInZone(coachTimezone)");
    expect(src("lib/dashboard-data.ts")).toContain("daysAgoKeyInZone(timezone, days, now)");
  });
});

describe("no page asks the database for 'all my groups' in one request", () => {
  it("only the files listed (a person's own few groups) still use a plain list of group ids; no new one may be added", () => {
    const baseline = JSON.parse(src("lib/unchunked-group-in-baseline.json")) as Record<string, number>;
    const found: Record<string, number> = {};
    for (const d of ["app", "components", "lib"]) {
      for (const f of walk(d)) {
        const s = src(f);
        if (s.includes("@/lib/read-by-ids") || s.includes("./read-by-ids")) continue;
        const n = (s.match(/\.in\("group_id", /g) || []).length;
        if (n) found[f] = n;
      }
    }
    for (const [f, n] of Object.entries(found)) expect(n, f).toBeLessThanOrEqual(baseline[f] ?? 0);
  });
  it("the rest of the heavy readers use groups of ids and pages", () => {
    for (const f of [
      "lib/coach-groups.ts",
      "lib/business-scope.ts",
      "lib/coach-mrr.ts",
      "lib/dashboard-data.ts",
      "lib/coach-briefing-gather.ts",
      "lib/needs-you-data.ts",
      "lib/coach-inbox-data.ts",
      "app/(coach)/groups/[groupId]/business/page.tsx",
      "app/(coach)/dashboard/page.tsx",
      "app/api/cron/coach-digest/route.ts",
      "app/api/cron/rest-day-nudge/route.ts",
      "app/api/cron/expire-session-credits/route.ts",
    ]) {
      const s = src(f);
      expect(s.includes("read-by-ids") || s.includes("pageAll"), f).toBe(true);
    }
  });
});

describe("the nightly jobs have room and the new ones are wired", () => {
  it("every job that loops over people may run five minutes", () => {
    for (const name of ["coach-briefing", "coach-digest", "rest-day-nudge", "expire-session-credits", "milestone-scan", "nutrition-checkin-suggestions", "spotter-tier-sync", "series-top-up", "attendance-nudge-sms", "session-reminder", "flag-recurring-booking-conflicts", "process-booking-waitlist", "google-calendar-sync"]) {
      expect(src(`app/api/cron/${name}/route.ts`), name).toContain("export const maxDuration = 300;");
    }
  });
  it("the stale-workout job exists, is scheduled, is watched, and the watchdog checks it nightly", () => {
    expect(src("app/api/cron/close-stale-sessions/route.ts")).toContain('rpc("close_stale_sessions"');
    expect(src("vercel.json")).toContain("/api/cron/close-stale-sessions");
    expect(src("lib/cron-jobs.ts")).toContain("close-stale-sessions");
    expect(src("app/api/cron/cron-watchdog/route.ts")).toContain("staleOpenSessions");
  });
  it("the paste is its own step and bundle", () => {
    const build = src("scripts/build-paste-files.mjs");
    expect(build).toContain('n: "141"');
    expect(build).toContain('id: "release-g"');
    const sql = src("supabase/migrations/0389_scale_and_data_quality.sql");
    for (const piece of ["business_last_active", "coach_unseen_groups", "coach_digest_activity", "set_logs_values_in_range", "close_stale_sessions", "is_test"]) expect(sql).toContain(piece);
  });
});
