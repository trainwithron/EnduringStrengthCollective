import type { SupabaseClient } from "@supabase/supabase-js";
import type { VisibilityWindow } from "./program-schedule";
import { compareProgramOrder } from "./session-stack";

// Every program that is currently active for one athlete: the group's shared
// programs plus any personal ones assigned to them. Several can be active at
// once (a main program, a mobility program, a warm-up flow), so callers get
// the whole list in the coach's order and decide what to do with it, instead
// of a single "the" program that quietly hides the others.
export interface ActiveProgram {
  id: string;
  name: string;
  label: string | null;
  sortOrder: number | null;
  createdAt: string;
  athleteId: string | null;
  startDate: string | null;
  trainingDays: number[] | null;
  visibilityWindow: VisibilityWindow;
}

const BASE_COLUMNS = "id, name, created_at, athlete_id, start_date, training_days, visibility_window";

interface Row {
  id: string;
  name: string;
  created_at: string;
  athlete_id: string | null;
  start_date: string | null;
  training_days: number[] | null;
  visibility_window: string | null;
  label?: string | null;
  sort_order?: number | null;
}

export async function getActivePrograms(
  supabase: SupabaseClient,
  groupId: string,
  athleteId: string
): Promise<ActiveProgram[]> {
  const run = (columns: string) =>
    supabase
      .from("programs")
      .select(columns)
      .eq("group_id", groupId)
      .eq("is_active", true)
      .or(`athlete_id.is.null,athlete_id.eq.${athleteId}`);

  // In a one-on-one space (a coach and one client) a program with no client on it is the coach's template, never what the client follows: only programs made for the client count.
  const [kindResult, firstResult] = await Promise.all([
    supabase.from("groups").select("group_kind").eq("id", groupId).maybeSingle(),
    // label / sort_order come from a later migration; until it is applied the
    // select fails, and we simply read without them (no label, oldest first).
    run(`${BASE_COLUMNS}, label, sort_order`),
  ]);
  const oneOnOne = (kindResult.data as { group_kind?: string | null } | null)?.group_kind === "one_on_one";
  let { data, error } = firstResult;
  if (error) ({ data, error } = await run(BASE_COLUMNS));
  if (error || !data) return [];

  return (data as unknown as Row[])
    .filter((r) => !oneOnOne || r.athlete_id !== null)
    .map<ActiveProgram>((r) => ({
      id: r.id,
      name: r.name,
      label: r.label ?? null,
      sortOrder: r.sort_order ?? null,
      createdAt: r.created_at,
      athleteId: r.athlete_id,
      startDate: r.start_date,
      trainingDays: r.training_days,
      visibilityWindow: (r.visibility_window as VisibilityWindow) ?? "day",
    }))
    .sort(compareProgramOrder);
}
