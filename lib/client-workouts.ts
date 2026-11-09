import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoachedGroups } from "@/lib/coach-groups";

// A coach's Client workouts view (top of the Feed tab, Ron Nov 9): every finished workout across their one-on-one clients, newest first. Each of those clients trains in a private
// space the group feed never shows, so this reads the workouts themselves, and a client who keeps their workouts off a group feed is still listed: their coach can already open those.
export const CLIENT_WORKOUTS_PAGE = 50;

export interface ClientWorkout {
  id: string;
  clientName: string;
  groupId: string;
  athleteId: string;
  title: string;
  createdAt: string;
  sessionId: string | null;
  loggedByCoach: boolean;
  volume: number | null;
  sets: number | null;
  durationSeconds: number | null;
  prs: string[];
  exerciseNames: string[];
}

export function clientWorkoutsLimit(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > CLIENT_WORKOUTS_PAGE ? Math.min(n, 500) : CLIENT_WORKOUTS_PAGE;
}

// What the Feed tab opens on. A coach lands on Client workouts; a link that asks for something in the group feed (a channel, a post, a group) goes to the group feed as it always did.
export function showClientWorkouts(q: { view?: string; channel?: string; highlight?: string; group?: string }): boolean {
  if (q.view === "group") return false;
  return q.view === "clients" || (!q.channel && !q.highlight && !q.group);
}

export async function loadClientWorkouts(supabase: SupabaseClient, coachId: string, limit: number): Promise<{ workouts: ClientWorkout[]; hasMore: boolean }> {
  const groupIds = (await getCoachedGroups(supabase, coachId)).filter((g) => g.kind === "one_on_one").map((g) => g.id);
  if (groupIds.length === 0) return { workouts: [], hasMore: false };

  // A coach can have hundreds of clients: ask a hundred groups at a time, each for its newest, then take the newest of those.
  const chunks: string[][] = [];
  for (let i = 0; i < groupIds.length; i += 100) chunks.push(groupIds.slice(i, i + 100));
  const answers = await Promise.all(
    chunks.map((ids) =>
      supabase
        .from("workout_logs")
        .select("id, athlete_id, group_id, session_id, total_volume, total_sets_completed, total_duration_seconds, new_prs, created_at, logged_by_coach, workouts ( title )")
        .in("group_id", ids)
        .neq("athlete_id", coachId)
        .order("created_at", { ascending: false })
        .limit(limit + 1)
    )
  );
  const rows = answers.flatMap((a) => (a.data ?? []) as any[]).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const page = rows.slice(0, limit);

  const athleteIds = [...new Set(page.map((r) => r.athlete_id as string).filter(Boolean))];
  const sessionIds = [...new Set(page.map((r) => r.session_id as string | null).filter((s): s is string => !!s))];
  const [{ data: people }, { data: exercises }] = await Promise.all([
    athleteIds.length > 0 ? supabase.from("profiles").select("id, full_name").in("id", athleteIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    sessionIds.length > 0
      ? supabase.from("session_exercises").select("session_id, exercise_name").in("session_id", sessionIds).limit(5000)
      : Promise.resolve({ data: [] as { session_id: string; exercise_name: string | null }[] }),
  ]);
  const nameById = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const exercisesBySession = new Map<string, string[]>();
  for (const e of exercises ?? []) {
    if (!e.exercise_name) continue;
    const list = exercisesBySession.get(e.session_id) ?? [];
    if (!list.includes(e.exercise_name)) list.push(e.exercise_name);
    exercisesBySession.set(e.session_id, list);
  }

  return {
    hasMore: rows.length > limit,
    workouts: page.map((r) => ({
      id: r.id,
      clientName: nameById.get(r.athlete_id) ?? "Client",
      groupId: r.group_id,
      athleteId: r.athlete_id,
      title: r.workouts?.title ?? "Workout",
      createdAt: r.created_at,
      sessionId: r.session_id ?? null,
      loggedByCoach: !!r.logged_by_coach,
      volume: r.total_volume ?? null,
      sets: r.total_sets_completed ?? null,
      durationSeconds: r.total_duration_seconds ?? null,
      prs: r.new_prs ?? [],
      exerciseNames: r.session_id ? (exercisesBySession.get(r.session_id) ?? []) : [],
    })),
  };
}
