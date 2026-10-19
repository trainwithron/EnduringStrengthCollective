import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withCronRun } from "@/lib/cron-monitor";
import { readRowsByIds } from "@/lib/read-by-ids";
import { sendCoachPush } from "@/lib/coach-notice";
import { pickSessionsToComplete, savedDurationSeconds, type CompletedSet, type OpenSession } from "@/lib/stale-session-complete";

// Triggered daily by the Vercel Cron entry in vercel.json (CRON_SECRET header, like every other job). A workout still "in progress" three days after it was started was left open by mistake: it is set to
// paused (the same state as Pause for later, so the client can still resume it) so it stops counting as a live workout and stops holding screens and counts open.
const STALE_SESSION_DAYS = 3;

// A client's own workout left open or paused with sets logged is saved as finished (lib/stale-session-complete.ts), through the same function the Complete button uses, then dated and timed by its last set.
// No database change: complete_workout_session already accepts the service role. A failure on one session never stops the rest.
async function saveStaleWorkoutsWithSets(db: ReturnType<typeof createServiceRoleClient>): Promise<{ saved: number; failed: number }> {
  const now = new Date();
  const cutoffIso = new Date(now.getTime() - STALE_SESSION_DAYS * 86400000).toISOString();
  const { data: open, error } = await db
    .from("athlete_sessions")
    .select("id, athlete_id, group_id, started_at, resumed_at")
    .in("status", ["in_progress", "abandoned"])
    .eq("logged_by_coach", false)
    .lt("started_at", cutoffIso)
    .order("started_at")
    .limit(500);
  if (error || !open || open.length === 0) return { saved: 0, failed: error ? 1 : 0 };
  const sessions = open as OpenSession[];
  const { data: setRows, error: setError } = await readRowsByIds(sessions.map((s) => s.id), (ids) => (from, to) =>
    db.from("set_logs").select("id, completed_at, created_at, session_exercises!inner(session_id)").eq("status", "completed").in("session_exercises.session_id", ids).order("id").range(from, to)
  );
  if (setError || !setRows) return { saved: 0, failed: 1 };
  const sets: CompletedSet[] = (setRows as { completed_at: string | null; created_at: string; session_exercises: { session_id: string } | { session_id: string }[] }[]).map((r) => ({
    session_id: Array.isArray(r.session_exercises) ? r.session_exercises[0]?.session_id : r.session_exercises?.session_id,
    at: r.completed_at ?? r.created_at,
  }));
  let saved = 0;
  let failed = 0;
  for (const s of pickSessionsToComplete(sessions, sets, now, STALE_SESSION_DAYS)) {
    const { error: completeError } = await db.rpc("complete_workout_session", { p_session_id: s.id });
    if (completeError) {
      failed += 1;
      continue;
    }
    saved += 1;
    // The history shows it on the day the sets were logged, with the time it really took, not days.
    const seconds = savedDurationSeconds(s.startedAt, s.lastSetAt);
    await db.from("workout_logs").update({ total_duration_seconds: seconds, created_at: s.lastSetAt }).eq("session_id", s.id);
    await db.from("athlete_sessions").update({ completed_at: s.lastSetAt, duration_seconds: seconds }).eq("id", s.id);
    try {
      const [{ data: coach }, { data: who }] = await Promise.all([
        db.from("group_memberships").select("profile_id").eq("group_id", s.groupId).eq("role", "coach").limit(1).maybeSingle(),
        db.from("profiles").select("full_name").eq("id", s.athleteId).maybeSingle(),
      ]);
      if (coach?.profile_id) {
        const name = (who as { full_name?: string | null } | null)?.full_name ?? "A client";
        await sendCoachPush(db, coach.profile_id as string, "client_activity", "Workout saved", `${name} left a workout unfinished with ${s.sets} ${s.sets === 1 ? "set" : "sets"} logged; it was saved as done.`, `/groups/${s.groupId}/athletes/${s.athleteId}`, { daytimeOnly: true });
      }
    } catch {
      // the workout is saved; the note is best effort
    }
  }
  return { saved, failed };
}

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = createServiceRoleClient();
  // First save the ones with sets logged; close_stale_sessions then only pauses what is left (nothing logged).
  const savedWork = await saveStaleWorkoutsWithSets(supabase).catch(() => ({ saved: 0, failed: 1 }));
  const { data, error } = await supabase.rpc("close_stale_sessions", { p_days: STALE_SESSION_DAYS });
  if (error) {
    console.error("close-stale-sessions failed:", error.message);
    return NextResponse.json({ error: "Could not close the stale workouts." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, closed: typeof data === "number" ? data : 0, saved: savedWork.saved, saveFailed: savedWork.failed });
}

export const GET = withCronRun("close-stale-sessions", handler);
