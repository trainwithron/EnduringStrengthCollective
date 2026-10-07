import { endSeries, pauseSeries, resumeSeries, type SeriesStore } from "@/lib/series-engine";

// Applying a client's schedule request (migration 0297). The database hands out the work and keeps the rules (who may ask, one open request per schedule, the private
// note); this file does the part the database cannot: it changes the schedule with the existing engine (pause, end, resume) and tells the database how it went.
// Everything here runs with the SERVER (service-role) store, after the caller has been checked, never with a client's own session: that is what keeps a removed
// session refunded the way a coach's cancel is, and keeps anything from being flagged against the client.

export interface Rpc {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }>;
}

export type RequestKind = "pause" | "freeze" | "cancel";

// What claim_schedule_request and claim_due_schedule_requests return for one request.
export interface ClaimedRequest {
  request_id: string;
  series_id: string;
  kind: RequestKind;
  effective_on: string;
  resume_on: string | null;
  athlete_id: string;
  group_id: string;
  early: boolean;
}

export interface ApplyResult {
  ok: boolean;
  message: string;
}

const short = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 160);

// Applies one CLAIMED request and records the result. Safe to run twice: a schedule that is already in the state the request asks for counts as done (a coach may have
// paused it by hand in the meantime, or a run may have stopped between the change and the record).
export async function applyClaimedRequest(db: Rpc, store: SeriesStore, claim: ClaimedRequest, options: { bySystem: boolean }, now: Date = new Date()): Promise<ApplyResult> {
  const finish = async (ok: boolean, error: string | null): Promise<ApplyResult> => {
    const { error: recordError } = await db.rpc("finish_schedule_request", {
      p_request_id: claim.request_id,
      p_ok: ok,
      p_early: claim.early,
      p_by_system: options.bySystem,
      p_error: error,
    });
    // If the record fails the request stays "applying" and is reclaimed after ten minutes; the engine step is safe to run again.
    if (recordError) return { ok: false, message: "The change was made but could not be recorded. It will be recorded on the next run." };
    return ok ? { ok: true, message: "Done." } : { ok: false, message: error ?? "Could not be applied." };
  };

  const series = await store.getSeries(claim.series_id);
  if (!series) return finish(false, "this schedule was not found");
  if (series.status === "ended" || series.status === "cancelled") {
    // A cancel is already true. Anything else cannot be applied to a schedule that has ended: the coach is told and handles it.
    return claim.kind === "cancel" ? finish(true, null) : finish(false, "this schedule has already ended");
  }

  if (claim.kind === "cancel") {
    const r = await endSeries(store, claim.series_id, now, { cancelUpcoming: true });
    return r.ok ? finish(true, null) : finish(false, short(r.message));
  }

  // Pause and freeze both pause the schedule now; a freeze is told its resume day by the database when the result is recorded.
  if (series.status === "paused") return finish(true, null);
  const r = await pauseSeries(store, claim.series_id, now);
  return r.ok ? finish(true, null) : finish(false, short(r.message));
}

// The daily run: every request whose chosen day has ended.
export async function runDueScheduleRequests(db: Rpc, store: SeriesStore, now: Date = new Date()): Promise<{ applied: number; failed: number }> {
  const { data, error } = await db.rpc("claim_due_schedule_requests", { p_limit: 50 });
  if (error) throw new Error(`claim_due_schedule_requests: ${error.message}`);
  let applied = 0;
  let failed = 0;
  for (const claim of (data ?? []) as ClaimedRequest[]) {
    try {
      const r = await applyClaimedRequest(db, store, claim, { bySystem: true }, now);
      if (r.ok) applied += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.error(`schedule request ${claim.request_id} failed:`, err instanceof Error ? err.message : err);
      await db.rpc("finish_schedule_request", { p_request_id: claim.request_id, p_ok: false, p_early: false, p_by_system: true, p_error: "something went wrong" });
    }
  }
  return { applied, failed };
}

// The coach pressed Done on a request dated today or earlier. The caller has already checked the person is the group's coach or an org admin.
export async function applyRequestNow(db: Rpc, store: SeriesStore, requestId: string, now: Date = new Date()): Promise<ApplyResult> {
  const { data, error } = await db.rpc("claim_schedule_request", { p_request_id: requestId, p_by_coach: true });
  if (error) return { ok: false, message: error.message };
  return applyClaimedRequest(db, store, data as ClaimedRequest, { bySystem: false }, now);
}

// The daily run for freezes: every frozen schedule whose resume day has come starts again. A failed restart is counted and the coach is told (database), three tries.
export async function runDueFreezeResumes(db: Rpc, store: SeriesStore, now: Date = new Date()): Promise<{ resumed: number; failed: number }> {
  const { data, error } = await db.rpc("claim_due_freeze_resumes", { p_limit: 50 });
  if (error) throw new Error(`claim_due_freeze_resumes: ${error.message}`);
  let resumed = 0;
  let failed = 0;
  for (const row of (data ?? []) as { series_id: string }[]) {
    try {
      const series = await store.getSeries(row.series_id);
      if (!series || series.status !== "paused") {
        // Someone restarted or ended it already: only clear the freeze.
        await db.rpc("end_schedule_freeze", { p_series_id: row.series_id });
        continue;
      }
      const r = await resumeSeries(store, row.series_id, now);
      if (!r.ok) {
        failed += 1;
        await db.rpc("fail_freeze_resume", { p_series_id: row.series_id, p_error: short(r.message) });
        continue;
      }
      await db.rpc("end_schedule_freeze", { p_series_id: row.series_id });
      await db.rpc("note_schedule_resumed", { p_series_id: row.series_id, p_booked: r.booked ?? 0, p_not_booked: r.notBooked?.length ?? 0 });
      resumed += 1;
    } catch (err) {
      failed += 1;
      console.error(`freeze resume ${row.series_id} failed:`, err instanceof Error ? err.message : err);
      await db.rpc("fail_freeze_resume", { p_series_id: row.series_id, p_error: "something went wrong" });
    }
  }
  return { resumed, failed };
}
