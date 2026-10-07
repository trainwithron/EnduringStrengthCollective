import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { BookingRow, CoachContext, NewSeries, SeriesRow, SeriesStore } from "@/lib/series-engine";
import { applyClaimedRequest, applyRequestNow, runDueFreezeResumes, runDueScheduleRequests, type ClaimedRequest, type Rpc } from "@/lib/schedule-requests";

const NOW = new Date("2026-10-13T12:00:00Z");

function seriesRow(patch: Partial<SeriesRow> = {}): SeriesRow {
  return {
    id: "s1", coachId: "c1", athleteId: "a1", groupId: "g1", weekday: 2, startTime: "06:00", durationMinutes: 60, mode: "ongoing", occurrencesTotal: null,
    status: "active", timezone: "America/New_York", anchorDate: "2026-09-01", windowWeeks: 12, endsOn: null, skippedStarts: [], pausedAt: null, pausedRemaining: null, ...patch,
  };
}

// A small in-memory stand-in for the schedule store: two future sessions to remove, and a record of what was cancelled and booked.
function fakeStore(initial: SeriesRow | null, opts: { cancelFails?: boolean } = {}) {
  const series = new Map<string, SeriesRow>();
  if (initial) series.set(initial.id, initial);
  const bookings = new Map<string, BookingRow>();
  for (const [i, day] of ["2026-10-20", "2026-10-27"].entries()) {
    bookings.set(`b${i}`, { id: `b${i}`, seriesId: "s1", coachId: "c1", athleteId: "a1", groupId: "g1", startAt: `${day}T10:00:00.000Z`, endAt: `${day}T11:00:00.000Z`, status: "confirmed", attendedAt: null, creditState: "unsettled" });
  }
  let n = 100;
  const context: CoachContext = { timezone: "America/New_York", bufferMinutes: 0, windows: [], exceptions: [] };
  const store: SeriesStore = {
    async coachContext() { return context; },
    async busy() { return []; },
    async insertSeries(row: NewSeries) { const id = `s${++n}`; const value = { id, ...row }; series.set(id, value); return { ok: true as const, value }; },
    async getSeries(id) { return series.get(id) ?? null; },
    async updateSeries(id, patch) { const cur = series.get(id); if (cur) series.set(id, { ...cur, ...patch }); },
    async seriesBookings(seriesId) { return [...bookings.values()].filter((b) => b.seriesId === seriesId && b.status === "confirmed"); },
    async getBooking(id) { return bookings.get(id) ?? null; },
    async book({ coachId, athleteId, groupId, start, end, seriesId }) {
      const id = `b${++n}`;
      bookings.set(id, { id, seriesId, coachId, athleteId, groupId, startAt: start.toISOString(), endAt: end.toISOString(), status: "confirmed", attendedAt: null, creditState: "unsettled" });
      return { ok: true as const, bookingId: id };
    },
    async cancel(id) {
      if (opts.cancelFails) return { ok: false as const, message: "not cancellable" };
      const b = bookings.get(id);
      if (!b) return { ok: false as const, message: "gone" };
      bookings.set(id, { ...b, status: "cancelled" });
      return { ok: true as const };
    },
    async mirror() {},
  };
  return { store, series, bookings };
}

function fakeRpc(responses: Record<string, any> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: Rpc = {
    async rpc(name: string, args: Record<string, unknown> = {}) {
      calls.push({ name, args });
      const r = responses[name];
      const v = typeof r === "function" ? r(args) : r;
      if (v?.error) return { data: null, error: { message: v.error } };
      return { data: v?.data ?? null, error: null };
    },
  } as unknown as Rpc;
  return { db, calls };
}

const claim = (patch: Partial<ClaimedRequest> = {}): ClaimedRequest => ({
  request_id: "r1", series_id: "s1", kind: "pause", effective_on: "2026-10-12", resume_on: null, athlete_id: "a1", group_id: "g1", early: false, ...patch,
});
const finishCall = (calls: { name: string; args: Record<string, unknown> }[]) => calls.find((c) => c.name === "finish_schedule_request");

describe("applying a claimed schedule request", () => {
  it("a pause takes the future sessions off the calendar and records success (the daily run tells the coach too)", async () => {
    const { store, series, bookings } = fakeStore(seriesRow());
    const { db, calls } = fakeRpc();
    const r = await applyClaimedRequest(db, store, claim(), { bySystem: true }, NOW);
    expect(r.ok).toBe(true);
    expect(series.get("s1")?.status).toBe("paused");
    expect([...bookings.values()].every((b) => b.status === "cancelled")).toBe(true);
    expect(finishCall(calls)?.args).toMatchObject({ p_request_id: "r1", p_ok: true, p_early: false, p_by_system: true, p_error: null });
  });

  it("a freeze pauses the schedule the same way and passes the early flag through", async () => {
    const { store, series } = fakeStore(seriesRow());
    const { db, calls } = fakeRpc();
    await applyClaimedRequest(db, store, claim({ kind: "freeze", resume_on: "2026-11-10", early: true }), { bySystem: false }, NOW);
    expect(series.get("s1")?.status).toBe("paused");
    expect(finishCall(calls)?.args).toMatchObject({ p_ok: true, p_early: true, p_by_system: false });
  });

  it("a cancel ends the schedule and keeps history (only future sessions leave)", async () => {
    const { store, series, bookings } = fakeStore(seriesRow());
    const { db, calls } = fakeRpc();
    await applyClaimedRequest(db, store, claim({ kind: "cancel" }), { bySystem: true }, NOW);
    expect(series.get("s1")?.status).toBe("ended");
    expect([...bookings.values()].filter((b) => b.status === "cancelled")).toHaveLength(2);
    expect(finishCall(calls)?.args.p_ok).toBe(true);
  });

  it("running twice is safe: an already paused schedule is not paused again, and an already ended one counts as a done cancel", async () => {
    const paused = fakeStore(seriesRow({ status: "paused" }));
    const a = fakeRpc();
    await applyClaimedRequest(a.db, paused.store, claim(), { bySystem: true }, NOW);
    expect(finishCall(a.calls)?.args.p_ok).toBe(true);
    expect([...paused.bookings.values()].every((b) => b.status === "confirmed")).toBe(true); // nothing touched again

    const ended = fakeStore(seriesRow({ status: "ended" }));
    const b = fakeRpc();
    await applyClaimedRequest(b.db, ended.store, claim({ kind: "cancel" }), { bySystem: true }, NOW);
    expect(finishCall(b.calls)?.args.p_ok).toBe(true);
  });

  it("a pause or freeze for a schedule that has already ended cannot be applied: the coach is told through the failure path", async () => {
    const { store } = fakeStore(seriesRow({ status: "ended" }));
    const { db, calls } = fakeRpc();
    const r = await applyClaimedRequest(db, store, claim(), { bySystem: true }, NOW);
    expect(r.ok).toBe(false);
    expect(finishCall(calls)?.args).toMatchObject({ p_ok: false, p_error: "this schedule has already ended" });
  });

  it("a freeze whose restart day has already come is not applied: the schedule keeps running", async () => {
    const { store, series } = fakeStore(seriesRow());
    const { db, calls } = fakeRpc();
    await applyClaimedRequest(db, store, claim({ kind: "freeze", resume_on: "2026-10-13" }), { bySystem: true }, NOW);
    expect(series.get("s1")?.status).toBe("active");
    expect(finishCall(calls)?.args).toMatchObject({ p_ok: true });
  });

  it("the freeze check uses the database's own today, not the app's clock: a schedule with no zone of its own and a coach far from New York", async () => {
    // 04:00 UTC on Oct 14 is still Oct 13 in New York but already Oct 14 for a coach in Auckland: the database says today is Oct 14.
    const late = new Date("2026-10-13T20:00:00Z");
    const { store, series } = fakeStore(seriesRow({ timezone: null }));
    const a = fakeRpc();
    await applyClaimedRequest(a.db, store, claim({ kind: "freeze", resume_on: "2026-10-14", today: "2026-10-14" }), { bySystem: true }, late);
    expect(series.get("s1")?.status).toBe("active"); // the database's today is the restart day: nothing to freeze
    const b = fakeStore(seriesRow({ timezone: null }));
    const c = fakeRpc();
    await applyClaimedRequest(c.db, b.store, claim({ kind: "freeze", resume_on: "2026-10-14", today: "2026-10-13" }), { bySystem: true }, late);
    expect(b.series.get("s1")?.status).toBe("paused"); // the database's today is a day earlier: the freeze is still ahead
  });

  it("what is stored on the request row (the client can read it) is a fixed sentence, never an engine message", async () => {
    const missing = fakeStore(null);
    const a = fakeRpc();
    await applyClaimedRequest(a.db, missing.store, claim(), { bySystem: true }, NOW);
    expect(finishCall(a.calls)?.args.p_error).toBe("this schedule was not found");
    const failing = fakeStore(seriesRow());
    const throwing: SeriesStore = { ...failing.store, async cancel() { return { ok: false as const, message: "raw engine text: connection refused" }; } };
    const b = fakeRpc();
    await applyClaimedRequest(b.db, throwing, claim(), { bySystem: true }, NOW);
    const stored = finishCall(b.calls)?.args.p_error;
    expect(stored === null || !/engine|connection|refused/.test(String(stored))).toBe(true);
    const src = readFileSync(new URL("./schedule-requests.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/p_error: short\(/);
  });

  it("a schedule that no longer exists is reported, not crashed on", async () => {
    const { store } = fakeStore(null);
    const { db, calls } = fakeRpc();
    const r = await applyClaimedRequest(db, store, claim(), { bySystem: true }, NOW);
    expect(r.ok).toBe(false);
    expect(finishCall(calls)?.args.p_ok).toBe(false);
  });

  it("when the result cannot be recorded the request is left to be reclaimed (the change itself was safe)", async () => {
    const { store } = fakeStore(seriesRow());
    const { db } = fakeRpc({ finish_schedule_request: { error: "database busy" } });
    const r = await applyClaimedRequest(db, store, claim(), { bySystem: true }, NOW);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/could not be recorded/);
  });
});

describe("the daily runs", () => {
  it("applies every due request and counts them; one that throws is recorded as failed and the others still run", async () => {
    const { store } = fakeStore(seriesRow());
    const bad = claim({ request_id: "r2", series_id: "s-bad" });
    const throwing: SeriesStore = { ...store, async getSeries(id) { if (id === "s-bad") throw new Error("boom"); return store.getSeries(id); } };
    const { db, calls } = fakeRpc({ claim_due_schedule_requests: { data: [claim(), bad] } });
    const out = await runDueScheduleRequests(db, throwing, NOW);
    expect(out).toEqual({ applied: 1, failed: 1 });
    const finishes = calls.filter((c) => c.name === "finish_schedule_request");
    expect(finishes.map((f) => f.args.p_request_id)).toEqual(["r1", "r2"]);
    expect(finishes[1].args).toMatchObject({ p_ok: false, p_error: "something went wrong" });
  });

  it("a coach's Done applies exactly the claimed request, not early-checked here (the database refuses a future date)", async () => {
    const { store, series } = fakeStore(seriesRow());
    const { db, calls } = fakeRpc({ claim_schedule_request: { data: claim({ early: true }) } });
    const r = await applyRequestNow(db, store, "r1", NOW);
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual({ name: "claim_schedule_request", args: { p_request_id: "r1", p_by_coach: true } });
    expect(series.get("s1")?.status).toBe("paused");
    expect(finishCall(calls)?.args).toMatchObject({ p_early: true, p_by_system: false });
  });

  it("a refused claim (dated in the future, already handled) changes nothing", async () => {
    const { store, series } = fakeStore(seriesRow());
    const { db, calls } = fakeRpc({ claim_schedule_request: { error: "this request is dated Nov 10 and applies by itself after that day" } });
    const r = await applyRequestNow(db, store, "r1", NOW);
    expect(r).toEqual({ ok: false, message: "this request is dated Nov 10 and applies by itself after that day" });
    expect(series.get("s1")?.status).toBe("active");
    expect(calls.map((c) => c.name)).toEqual(["claim_schedule_request"]);
  });

  it("a freeze whose day has come restarts, clears the freeze and tells the coach how many sessions were booked", async () => {
    const { store, series } = fakeStore(seriesRow({ status: "paused", pausedRemaining: 0 }));
    const { db, calls } = fakeRpc({ claim_due_freeze_resumes: { data: [{ series_id: "s1" }] } });
    const out = await runDueFreezeResumes(db, store, NOW);
    expect(out).toEqual({ resumed: 1, failed: 0 });
    expect(series.get("s1")?.status).toBe("active");
    expect(calls.map((c) => c.name)).toEqual(["claim_due_freeze_resumes", "end_schedule_freeze", "note_schedule_resumed"]);
    expect(calls[2].args).toMatchObject({ p_series_id: "s1" });
    expect(typeof calls[2].args.p_booked).toBe("number");
  });

  it("a freeze someone already restarted by hand is only cleared (no second restart, no note)", async () => {
    const { store } = fakeStore(seriesRow({ status: "active" }));
    const { db, calls } = fakeRpc({ claim_due_freeze_resumes: { data: [{ series_id: "s1" }] } });
    const out = await runDueFreezeResumes(db, store, NOW);
    expect(out).toEqual({ resumed: 0, failed: 0 });
    expect(calls.map((c) => c.name)).toEqual(["claim_due_freeze_resumes", "end_schedule_freeze"]);
  });

  it("a restart that fails is counted and handed to the database (which tells the coach), never retried in a loop", async () => {
    const { store } = fakeStore(seriesRow({ status: "paused", anchorDate: null }));
    const { db, calls } = fakeRpc({ claim_due_freeze_resumes: { data: [{ series_id: "s1" }] } });
    const out = await runDueFreezeResumes(db, store, NOW);
    expect(out).toEqual({ resumed: 0, failed: 1 });
    expect(calls.map((c) => c.name)).toEqual(["claim_due_freeze_resumes", "fail_freeze_resume"]);
  });
});

describe("the wiring", () => {
  const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  it("the daily job needs the cron secret, runs requests then resumes, and is on the schedule before the top-up job", () => {
    const route = src("../app/api/cron/schedule-requests/route.ts");
    expect(route).toContain('request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`');
    expect(route.indexOf("runDueScheduleRequests(db, store)")).toBeLessThan(route.indexOf("runDueFreezeResumes(db, store)"));
    expect(route).toContain('withCronRun("schedule-requests", handler)');
    const vercel = JSON.parse(src("../vercel.json"));
    const paths = vercel.crons.map((c: { path: string }) => c.path);
    expect(paths.indexOf("/api/cron/schedule-requests")).toBeGreaterThan(-1);
    expect(paths.indexOf("/api/cron/schedule-requests")).toBeLessThan(paths.indexOf("/api/cron/series-top-up"));
  });
  it("the coach route checks the person is the group's coach or an org admin before it applies anything, and a handled request never touches the schedule", () => {
    const route = src("../app/api/series/schedule-request/route.ts");
    expect(route.indexOf("is_group_coach")).toBeLessThan(route.indexOf("await applyRequestNow("));
    expect(route).toContain("is_org_admin_of_group");
    const handled = route.slice(route.indexOf('if (action === "handled")'), route.indexOf("const db = createServiceRoleClient()"));
    expect(handled).toContain("dismiss_schedule_request");
    expect(handled).not.toContain("applyRequestNow(");
  });
  it("restarting or ending a schedule by hand also clears a freeze", () => {
    const route = src("../app/api/series/[seriesId]/route.ts");
    expect(route).toContain("end_schedule_freeze");
    expect(route.match(/clearFreeze\(lookup\.db, seriesId\)/g)?.length).toBe(2);
  });
});
