import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CRON_JOBS, MONITORING_STARTED, findStaleJobs, shouldAlertForFailures, type CronRunRow } from "@/lib/cron-jobs";

describe("job list", () => {
  it("matches vercel.json exactly", () => {
    const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "vercel.json"), "utf8"));
    const configured = (vercel.crons as { path: string }[]).map((c) => c.path).sort();
    const listed = CRON_JOBS.map((j) => j.path).sort();
    expect(listed).toEqual(configured);
  });

  it("has a route file for every job", () => {
    for (const j of CRON_JOBS) {
      const file = path.resolve(__dirname, "..", "app", ...j.path.replace(/^\//, "").split("/"), "route.ts");
      expect(fs.existsSync(file), j.path).toBe(true);
    }
  });

  it("job names are unique", () => {
    expect(new Set(CRON_JOBS.map((j) => j.job)).size).toBe(CRON_JOBS.length);
  });
});

describe("stale jobs", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();
  const allOk = (): CronRunRow[] => CRON_JOBS.map((j) => ({ job: j.job, last_success_at: hoursAgo(0.2), last_status: "ok", consecutive_failures: 0 }));

  it("nothing is stale when everything ran recently", () => {
    expect(findStaleJobs(allOk(), now)).toEqual([]);
  });

  it("a job that is failing is reported", () => {
    const rows = allOk().map((r) => (r.job === "coach-digest" ? { ...r, last_status: "error", consecutive_failures: 2 } : r));
    expect(findStaleJobs(rows, now)).toEqual([{ job: "coach-digest", reason: "failing", hoursSinceSuccess: 0.2 }]);
  });

  it("a daily job that has not succeeded for over 30 hours is reported", () => {
    const rows = allOk().map((r) => (r.job === "series-top-up" ? { ...r, last_success_at: hoursAgo(40) } : r));
    const stale = findStaleJobs(rows, now);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ job: "series-top-up", reason: "not_run_recently" });
  });

  it("a frequent job is stale after about an hour", () => {
    const rows = allOk().map((r) => (r.job === "session-reminder" ? { ...r, last_success_at: hoursAgo(2) } : r));
    expect(findStaleJobs(rows, now).map((s) => s.job)).toEqual(["session-reminder"]);
  });

  it("a weekly job is fine for several days", () => {
    const rows = allOk().map((r) => (r.job === "milestone-scan" ? { ...r, last_success_at: hoursAgo(5 * 24) } : r));
    expect(findStaleJobs(rows, now)).toEqual([]);
  });

  it("a job that has never run is reported only after the grace period", () => {
    const rows = allOk().filter((r) => r.job !== "rest-day-nudge");
    expect(findStaleJobs(rows, now, { since: new Date(now.getTime() - 10 * 3600000) })).toEqual([]);
    expect(findStaleJobs(rows, now, { since: new Date(now.getTime() - 72 * 3600000) })).toEqual([{ job: "rest-day-nudge", reason: "never_run", hoursSinceSuccess: null }]);
    expect(findStaleJobs(rows, now)).toHaveLength(1);
  });

  it("a job that has only ever failed counts as not run recently when it is not flagged as failing", () => {
    const rows = allOk().map((r) => (r.job === "coach-briefing" ? { ...r, last_success_at: null } : r));
    expect(findStaleJobs(rows, now)[0]).toMatchObject({ job: "coach-briefing", reason: "not_run_recently" });
  });
});

describe("never-run jobs", () => {
  // Only the busy jobs have a row; the rest have never been called.
  const rows = (now: Date): CronRunRow[] => CRON_JOBS.filter((j) => j.job === "session-reminder").map((j) => ({ job: j.job, last_success_at: now.toISOString(), last_status: "ok", consecutive_failures: 0 }));
  const since = MONITORING_STARTED;

  it("is not reported inside the grace period, then is reported for a daily job", () => {
    const early = new Date(since.getTime() + 24 * 3600000);
    const late = new Date(since.getTime() + 50 * 3600000);
    expect(findStaleJobs(rows(early), early, { since })).toEqual([]);
    const stale = findStaleJobs(rows(late), late, { since });
    expect(stale.find((s) => s.job === "google-health-sync")).toMatchObject({ reason: "never_run" });
  });
  it("gives a weekly job its whole interval before calling it never run", () => {
    const day4 = new Date(since.getTime() + 4 * 86400000);
    const day9 = new Date(since.getTime() + 9 * 86400000);
    expect(findStaleJobs(rows(day4), day4, { since }).some((s) => s.job === "milestone-scan")).toBe(false);
    expect(findStaleJobs(rows(day9), day9, { since }).some((s) => s.job === "milestone-scan")).toBe(true);
  });
});

describe("alert cadence", () => {
  it("alerts on the first failure and then rarely", () => {
    expect([1, 2, 3, 4, 9, 10, 11, 29, 30, 31].filter(shouldAlertForFailures)).toEqual([1, 3, 10, 30]);
    expect(shouldAlertForFailures(0)).toBe(false);
  });
});
