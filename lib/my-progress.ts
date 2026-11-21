import type { SupabaseClient } from "@supabase/supabase-js";
import { hindsightPrs, importedWorkouts, parseRollup } from "@/lib/imported-prs";
import { planCards, summarizeExercises, type LadderInput, type SeriesPoint } from "@/lib/progress-cards";
import { dateKeyInZone, type StatEvent } from "@/lib/progress-periods";
import { repMaxTablesByLift, type RepMaxTable } from "@/lib/rep-maxes";
import { readLoggedSets } from "@/lib/read-logged-sets";
import { e1rmSeriesFor } from "@/lib/progress-lines";

// "My progress" (wave 2, P1 + P2; Ron, Nov 20): the client's own read-only view of the coach's Progress tab. The same cards (lib/progress-cards.ts: the coach's
// pins first, then the big five, then the rest), the same period stats (lib/progress-periods.ts) and the same sets (client_exercise_rollup, a plain SQL function
// that runs with the client's own access, so it returns only their own workouts), plus the best at each rep count for every card's lift (lib/rep-maxes.ts).
// Read-only: nothing here writes. The coach's pins and movement ladders are read where the client may read them; where they may not, the cards fall back to the
// big five found by the lifts' names, the way a client with no ladders gets them on the coach's page. Any read that fails leaves its part out, never the page.

export interface MyProgressCard {
  name: string;
  sessions: number;
  bestE1rm: number | null;
  bestWeight: number | null;
  weightSeries: SeriesPoint[];
  volumeSeries: SeriesPoint[];
  // the estimated max of each workout's best set, by the person's own day (the best of the day when there were two), oldest first: the line on the card
  e1rmSeries: SeriesPoint[];
  repMaxes: RepMaxTable | null;
}


export interface MyProgress {
  cards: MyProgressCard[];
  // how many cards show before Show all, and what they are showing in plain words (lib/progress-cards.ts planCards)
  visible: number;
  label: string;
  // the client's weigh-ins in this space, oldest first (pounds as stored)
  bodyWeight: SeriesPoint[];
  // for the period stats (ProgressStats)
  events: StatEvent[];
  prDateKeys: string[];
  todayKey: string;
  // some part could not be read: the page says so instead of showing an empty chart as if nothing had been done
  incomplete: boolean;
}

// How many rows of logged sets the rep tables read at most (a page at a time); far past what years of training on the card lifts holds.
const SET_PAGE = 1000;
const SET_PAGES = 10;
// How many cards (in card order) get a best-at-each-rep table.
export const REP_TABLE_CARDS = 20;

export async function loadMyProgress(
  supabase: SupabaseClient,
  input: { athleteId: string; groupId: string; timeZone: string; now?: Date }
): Promise<MyProgress> {
  const { athleteId, groupId, timeZone } = input;
  const todayKey = dateKeyInZone((input.now ?? new Date()).toISOString(), timeZone);
  let incomplete = false;

  const [rollupRes, logsRes, pinsRes, coachRes] = await Promise.all([
    supabase.rpc("client_exercise_rollup", { p_athlete: athleteId, p_group: groupId }),
    supabase.from("workout_logs").select("total_volume, new_prs, created_at").eq("athlete_id", athleteId).eq("group_id", groupId).order("created_at", { ascending: false }).limit(2000),
    supabase.from("client_progress_pins").select("exercise_name, pinned_at").eq("athlete_id", athleteId).eq("group_id", groupId).order("pinned_at", { ascending: true }),
    supabase.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "coach").limit(1).maybeSingle(),
  ]);
  if (rollupRes.error || logsRes.error) incomplete = true;

  const rollup = parseRollup(rollupRes.error ? [] : rollupRes.data);
  const logs = (logsRes.error ? [] : logsRes.data ?? []) as { total_volume: number | null; new_prs: string[] | null; created_at: string }[];

  // The coach's ladders, when the client may read them (a pattern's lifts decide which lift is the squat or the hinge); else none.
  let ladders: LadderInput[] = [];
  const coachId = (coachRes.data as { profile_id?: string } | null)?.profile_id ?? null;
  if (coachId) {
    const { data, error } = await supabase.from("movement_patterns").select("name, movement_pattern_exercises ( exercise_name, tier )").eq("created_by", coachId);
    if (!error) {
      ladders = ((data ?? []) as any[]).map((p) => ({
        patternName: String(p.name),
        exercises: ((p.movement_pattern_exercises ?? []) as any[]).map((e) => ({ name: String(e.exercise_name), tier: (e.tier as "A" | "B" | "C" | null) ?? null })),
      }));
    }
  }
  const pinned = pinsRes.error ? [] : ((pinsRes.data ?? []) as { exercise_name: string }[]).map((p) => p.exercise_name);
  const plan = planCards(summarizeExercises(rollup), ladders, pinned);

  // The period stats: logged workouts and imported history, and the records (live ones as celebrated, imported ones found in hindsight), the coach page's way.
  const events: StatEvent[] = [
    ...logs.map((l) => ({ date: dateKeyInZone(l.created_at, timeZone), volume: l.total_volume ?? 0 })),
    ...importedWorkouts(rollup).map((w) => ({ date: dateKeyInZone(w.at, timeZone), volume: w.volume })),
  ];
  const prDates: string[] = [];
  for (const l of logs) for (const _ of l.new_prs ?? []) prDates.push(l.created_at);
  for (const pr of hindsightPrs(rollup)) prDates.push(pr.date);
  const prDateKeys = prDates.sort((a, b) => b.localeCompare(a)).map((d) => dateKeyInZone(d, timeZone));

  // Best at each rep count, for the first cards' lifts (the ones a person looks at; the address of the read stays short): their counted sets, a page at a time.
  const names = plan.cards.slice(0, REP_TABLE_CARDS).map((c) => c.name);
  const tables = new Map<string, RepMaxTable>();
  if (names.length > 0) {
    const rows: { weight: number | null; reps: number | null; set_type?: string | null; completed_at: string | null; session_exercises: any }[] = [];
    for (let page = 0; page < SET_PAGES; page++) {
      const { data } = await readLoggedSets(
        supabase,
        "weight, reps, set_type, completed_at, session_exercises!inner ( exercise_name, athlete_sessions!inner ( athlete_id, group_id, status ) )",
        (q) =>
          q
            .eq("session_exercises.athlete_sessions.athlete_id", athleteId)
            .eq("session_exercises.athlete_sessions.group_id", groupId)
            .eq("session_exercises.athlete_sessions.status", "completed")
            .in("session_exercises.exercise_name", names)
            .eq("status", "completed")
            .order("id")
            .range(page * SET_PAGE, page * SET_PAGE + SET_PAGE - 1)
      );
      if (data == null) {
        incomplete = true;
        break;
      }
      rows.push(...(data as any[]));
      if ((data as any[]).length < SET_PAGE) break;
    }
    const sets = rows.map((r) => {
      const se = Array.isArray(r.session_exercises) ? r.session_exercises[0] : r.session_exercises;
      return { exerciseName: String(se?.exercise_name ?? ""), weight: r.weight, reps: r.reps, setType: r.set_type ?? null, at: r.completed_at ?? "" };
    });
    for (const [name, table] of repMaxTablesByLift(sets)) tables.set(name.trim().toLowerCase(), table);
  }

  const cards: MyProgressCard[] = plan.cards.map((c) => ({
    name: c.name,
    sessions: c.sessions,
    bestE1rm: c.bestE1rm,
    bestWeight: c.bestWeight,
    weightSeries: c.weightSeries,
    volumeSeries: c.volumeSeries,
    e1rmSeries: e1rmSeriesFor(rollup, c.name, timeZone),
    repMaxes: tables.get(c.name.trim().toLowerCase()) ?? null,
  }));
  // Body weight, the client's own weigh-ins in this space (a chip beside the lifts).
  let bodyWeight: SeriesPoint[] = [];
  {
    const { data, error } = await supabase.from("body_weight_logs").select("logged_date, weight").eq("athlete_id", athleteId).eq("group_id", groupId).order("logged_date", { ascending: true }).limit(2000);
    if (!error) bodyWeight = ((data ?? []) as { logged_date: string; weight: number }[]).map((w) => ({ date: String(w.logged_date), value: Number(w.weight) }));
  }
  return { cards, visible: plan.visible, label: plan.label, bodyWeight, events, prDateKeys, todayKey, incomplete };
}
