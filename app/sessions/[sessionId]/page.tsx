import { loadPostWorkoutCards } from "@/lib/post-workout-cards";
import { redirect } from "next/navigation";
import { isReadFailure } from "@/lib/read-failed";
import { NoAccess } from "@/components/shared/no-access";
import Link from "next/link";
import { createCrossOrgServerClient as createServerClient } from "@/lib/supabase/server";
import { SessionLogger } from "@/components/logging/session-logger";
import { resumedStartedAt } from "@/lib/resume-elapsed";
import { asSetType } from "@/lib/set-types";
import { LoadFailed } from "@/components/ui/load-failed";
import { loadLiftUnit } from "@/lib/lift-unit-server";
import { LiftUnitProvider } from "@/components/logging/lift-unit-context";
import type { PendingGateTask } from "@/components/session/rest-timer-bar";
import { isHabitDueOn } from "@/lib/habits";
import { DEFAULT_TRACKED_FIELDS } from "@/lib/exercise-fields";
import { CoachLoggedBadge } from "@/components/coach-logged-badge";
import { SendToClientButton } from "@/components/session/send-to-client-button";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import type { SessionExerciseEntry } from "@/lib/types";
import { findCorrelatingWeightSuggestion, resolveWeightSuggestion } from "@/lib/set-suggestions";
import { findAthleteVisibleCoachNoteForExercise } from "@/lib/exercise-note-history";
import { parseNumericReps } from "@/lib/program-card-visuals";
import { computePriorBest } from "@/lib/obstacle-unlock";
import { readLoggedSets } from "@/lib/read-logged-sets";
import { resumeSession } from "@/lib/resume-session";
import { countsForProgress } from "@/lib/set-types";
import { computeVolumeHistory } from "@/lib/exercise-volume-history";
import { sessionBackHref } from "@/lib/session-back-href";
import { ExitWorkoutButton } from "@/components/session/exit-workout-button";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { findDemo, type DemoRow } from "@/lib/exercise-demo";
import { getReadForViewer, type ReadForViewer } from "@/lib/read-content/for-viewer";
import { athleteIsMinor } from "@/lib/youth-block";
import { CoachModeBar } from "@/components/coach/mobile/coach-mode-bar";
import { shareHref } from "@/lib/share-token";

export const metadata = { title: "Workout" };

export default async function SessionPage(
  props: {
    params: Promise<{ sessionId: string }>;
    searchParams?: Promise<{ resume?: string }>;
  }
) {
  const params = await props.params;
  const query = (await props.searchParams) ?? {};
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: session, error: sessionError } = await supabase
    .from("athlete_sessions")
    .select("id, status, athlete_id, group_id, logged_by_coach, workout_id, started_at, workouts ( title )")
    .eq("id", params.sessionId)
    .single();

  // "No such row" (PGRST116) really is "not available"; any other error is a read that failed and must not look like a missing workout.
  if (isReadFailure(sessionError)) {
    return (
      <main className="min-h-screen bg-graphite text-chalk p-5">
        <LoadFailed />
      </main>
    );
  }
  if (!session) {
    return (
      <NoAccess>This session isn&apos;t available, or you don&apos;t have access to it.</NoAccess>
    );
  }

  // "Resume workout" from the workout page or Home: a paused workout goes back to in progress, exactly where it was (completed sets stay completed).
  if (query.resume === "1" && session.status === "abandoned") {
    const { resumed } = await resumeSession(supabase, session.id);
    if (resumed) {
      (session as { status: string }).status = "in_progress";
      // The timer carries on from where the work stopped; the time it sat paused is not counted.
      const { data: lastSet } = await supabase
        .from("set_logs")
        .select("completed_at, session_exercises!inner(session_id)")
        .eq("session_exercises.session_id", session.id)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const newStart = resumedStartedAt(session.started_at, (lastSet as { completed_at?: string | null } | null)?.completed_at ?? null, new Date());
      const { error: startError } = await supabase.from("athlete_sessions").update({ started_at: newStart }).eq("id", session.id);
      if (!startError) (session as { started_at: string }).started_at = newStart;
    }
  }
  // A paused workout is "Paused" for 48 hours after it was started, then "Not finished". It is never completed for him.
  const pausedRecently = !!session.started_at && Date.now() - new Date(session.started_at).getTime() < 48 * 3600000;

  const isOwnSession = session.athlete_id === user.id;

  // None of these 6 depend on `sessionExercises` (or on each other) — only
  // on fields `session` already has — so they run as one batch alongside
  // the exercises fetch itself, instead of each paying its own sequential
  // round trip later in the file where they used to live.
  const [
    { data: sessionExercises, error: sessionExercisesError },
    { data: coachMembership },
    { data: groupRow },
    { data: viewerMembership },
    { data: swipeProfile },
    { data: workoutLogForShare },
  ] = await Promise.all([
    supabase
      .from("session_exercises")
      .select(
        `
      id, exercise_name, exercise_order, is_swapped, is_added, movement_pattern_id, tracked_fields, group_workout_exercise_id, athlete_note,
      group_workout_exercises ( notes, exercise_name, display_name ),
      set_logs ( id, set_order, weight, reps, rpe, rir, tempo, time_seconds, height, distance, rest_seconds, pace, status, weight_confirmed, data_flag, data_flag_reason )
    `
      )
      .eq("session_id", params.sessionId)
      .order("exercise_order", { ascending: true }),
    // Exercise video/YouTube is attached on the coach's shared exercise
    // library, keyed by name — same lookup as the workout overview page.
    supabase
      .from("group_memberships")
      .select("profile_id")
      .eq("group_id", session.group_id)
      .eq("role", "coach")
      .limit(1)
      .maybeSingle(),
    // Per-group on/off preference for the gamified-logging thread.
    supabase.from("groups").select("gamification_enabled").eq("id", session.group_id).maybeSingle(),
    // Video upload/feedback visibility — RLS enforces the real boundary
    // regardless, this just decides what the UI offers.
    supabase
      .from("group_memberships")
      .select("role")
      .eq("group_id", session.group_id)
      .eq("profile_id", user.id)
      .maybeSingle(),
    // Swipe-direction preference — only ever needed for the athlete's own
    // session (SessionLogger also gates the prompt on viewerId === athleteId
    // independently), so this stays a genuine no-op query for a coach
    // logging in-person rather than adding a real round trip for them.
    isOwnSession
      ? supabase.from("profiles").select("exercise_swipe_direction").eq("id", session.athlete_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // A completed session's shareable card — only meaningful once
    // completed, so this stays a no-op for an in-progress session.
    session.status === "completed"
      ? supabase.from("workout_logs").select("id, posts ( id )").eq("session_id", params.sessionId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  // Which sets are warm-ups etc. Read on its own so the workout opens even if the set-type column is not there yet (every set is then a working set).
  const setTypeById = new Map<string, string>();
  {
    const setIds = (sessionExercises ?? []).flatMap((se: any) => (se.set_logs ?? []).map((sl: any) => sl.id as string));
    if (setIds.length > 0) {
      const { data: typeRows, error: typeError } = await supabase.from("set_logs").select("id, set_type").in("id", setIds);
      if (!typeError) for (const r of (typeRows ?? []) as Array<{ id: string; set_type: string | null }>) if (r.set_type) setTypeById.set(r.id, r.set_type);
    }
  }
  // A workout whose exercises could not be read is not an empty workout.
  if (sessionExercisesError) {
    return (
      <main className="min-h-screen bg-graphite text-chalk p-5">
        <LoadFailed />
      </main>
    );
  }
  const gamificationEnabled = groupRow?.gamification_enabled ?? true;
  // The group's "Post-workout cards and PR notices" setting (off by default for a team-sport group): whether finishing makes a feed card and a share card.
  const postWorkoutCards = await loadPostWorkoutCards(supabase, session.group_id);
  const viewerIsCoach = viewerMembership?.role === "coach";
  const canUploadVideo = isOwnSession || viewerIsCoach;
  const exerciseSwipeDirection: "vertical" | "horizontal" | null =
    (swipeProfile?.exercise_swipe_direction as "vertical" | "horizontal" | null) ?? null;
  const sharePostId: string | null = (workoutLogForShare?.posts as any)?.id ?? null;
  // The workout card is on every finished workout, for the client and the coach: its feed post when there is one, else the card built from the workout itself (a signed link).
  let workoutCardHref: string | null = sharePostId ? `/share/${sharePostId}` : null;
  if (!workoutCardHref && workoutLogForShare?.id) {
    try {
      workoutCardHref = shareHref(workoutLogForShare.id as string);
    } catch {
      workoutCardHref = null;
    }
  }

  // Prescribed values for the "extra" fields (RPE, RIR, tempo, etc.) —
  // shown as a placeholder hint during logging, never pre-committed into
  // set_logs itself (see start-workout-button.tsx). Keyed by
  // (group_workout_exercise_id, set_order) since that's the only stable
  // link back to the template once a session has its own copy of the sets.
  const templateExerciseIds = (sessionExercises ?? [])
    .map((se: any) => se.group_workout_exercise_id)
    .filter((id: string | null): id is string => id != null);

  const prescribedSetCountByExercise = new Map<string, number>();
  const targetsByExerciseAndOrder = new Map<
    string,
    {
      rpe: number | null;
      rir: number | null;
      tempo: string | null;
      timeSeconds: number | null;
      height: number | null;
      distance: number | null;
      restSeconds: number | null;
      restMaxSeconds: number | null;
      pace: string | null;
      reps: number | null;
      weight: number | null;
    }
  >();
  if (templateExerciseIds.length > 0) {
    const { data: templateSets } = await supabase
      .from("group_workout_exercise_sets")
      .select(
        "group_workout_exercise_id, set_order, target_rpe, target_rir, target_tempo, target_time_seconds, target_height, target_distance, target_rest_seconds, target_rest_max_seconds, target_pace, target_reps, target_weight"
      )
      .in("group_workout_exercise_id", templateExerciseIds);
    for (const t of templateSets ?? []) {
      prescribedSetCountByExercise.set(t.group_workout_exercise_id, (prescribedSetCountByExercise.get(t.group_workout_exercise_id) ?? 0) + 1);
      targetsByExerciseAndOrder.set(`${t.group_workout_exercise_id}:${t.set_order}`, {
        rpe: t.target_rpe,
        rir: t.target_rir,
        tempo: t.target_tempo,
        timeSeconds: t.target_time_seconds,
        height: t.target_height,
        distance: t.target_distance,
        restSeconds: t.target_rest_seconds,
        restMaxSeconds: t.target_rest_max_seconds,
        pace: t.target_pace,
        reps: parseNumericReps(t.target_reps),
        weight: t.target_weight,
      });
    }
  }

  // Correlating-week weight suggestion (lib/set-suggestions.ts) — real
  // logged history for this athlete on these exercises, joined back to
  // each historical set's OWN target reps/RPE/RIR the same way the
  // workout-overview page does it. A grayed-out hint only; never
  // committed into set_logs the way a coach-set target_weight already is.
  const exerciseNamesInSession = Array.from(
    new Set((sessionExercises ?? []).map((se: any) => se.exercise_name as string))
  );
  const { data: priorRows } = exerciseNamesInSession.length > 0
    ? await readLoggedSets(
        supabase,
        `
          weight, reps, rpe, rir, set_order, set_type, completed_at,
          session_exercises!inner (
            exercise_name, group_workout_exercise_id, session_id,
            athlete_sessions!inner ( athlete_id )
          )
        `,
        (q) =>
          q
            .in("session_exercises.exercise_name", exerciseNamesInSession)
            .eq("session_exercises.athlete_sessions.athlete_id", session.athlete_id)
            .eq("status", "completed")
      )
    : { data: [] as any[] };

  // Obstacle-unlock mechanic (lib/obstacle-unlock.ts) — this athlete's
  // real all-time best (weight/reps/single-set volume) per exercise name,
  // from the exact same historical rows already fetched just above for
  // the weight-suggestion feature (no new query) — but excluding THIS
  // session specifically, unlike that feature's own history. A "genuine
  // PR" can't be measured against a set logged moments ago in the same
  // session; the weight-suggestion feature's own history query is left
  // untouched since it's a separate, already-shipped behavior.
  const priorBestByExerciseName = new Map<
    string,
    { maxWeight: number | null; maxReps: number | null; maxVolume: number | null }
  >();
  // Exercise volume-history sparkline (lib/exercise-volume-history.ts) —
  // total tonnage per session on this exact exercise name, from the same
  // historical rows just below, excluding the current session for the
  // identical reason priorBestByExerciseName does: a session still in
  // progress isn't real history yet.
  const volumeHistoryByExerciseName = new Map<
    string,
    { sessionId: string; sessionDate: string; totalVolume: number }[]
  >();
  {
    const rowsByName = new Map<
      string,
      { weight: number | null; reps: number | null; sessionId: string; completedAt: string | null }[]
    >();
    // A warm-up or drop set from an earlier session never counts as the best to beat (the database does not call it a record either); it still counts as work done in the volume history.
    const countedRowsByName = new Map<string, typeof rowsByName extends Map<string, infer R> ? R : never>();
    for (const row of (priorRows ?? []) as any[]) {
      if (row.session_exercises.session_id === params.sessionId) continue;
      const name = row.session_exercises.exercise_name as string;
      const list = rowsByName.get(name) ?? [];
      const entry = {
        weight: row.weight,
        reps: row.reps,
        sessionId: row.session_exercises.session_id,
        completedAt: row.completed_at,
      };
      list.push(entry);
      rowsByName.set(name, list);
      if (countsForProgress(row.set_type)) {
        const counted = countedRowsByName.get(name) ?? [];
        counted.push(entry);
        countedRowsByName.set(name, counted);
      }
    }
    for (const [name, rows] of rowsByName) {
      priorBestByExerciseName.set(name, computePriorBest(countedRowsByName.get(name) ?? []));
      volumeHistoryByExerciseName.set(name, computeVolumeHistory(rows));
    }
  }

  const priorTemplateIds = Array.from(
    new Set(
      (priorRows ?? [])
        .map((r: any) => r.session_exercises.group_workout_exercise_id as string | null)
        .filter((id: string | null): id is string => !!id)
    )
  );
  const { data: priorTargetRows } = priorTemplateIds.length > 0
    ? await supabase
        .from("group_workout_exercise_sets")
        .select("group_workout_exercise_id, set_order, target_reps, target_rpe, target_rir")
        .in("group_workout_exercise_id", priorTemplateIds)
    : { data: [] as any[] };

  const priorTargetByExerciseAndOrder = new Map<
    string,
    { targetReps: number | null; targetRpe: number | null; targetRir: number | null }
  >();
  for (const row of priorTargetRows ?? []) {
    priorTargetByExerciseAndOrder.set(`${row.group_workout_exercise_id}::${row.set_order}`, {
      targetReps: parseNumericReps(row.target_reps),
      targetRpe: row.target_rpe,
      targetRir: row.target_rir,
    });
  }

  const historyByExerciseName = new Map<
    string,
    { loggedAt: string; weight: number | null; targetReps: number | null; targetRpe: number | null; targetRir: number | null }[]
  >();
  for (const row of (priorRows ?? []) as any[]) {
    // Weight suggestions are made from working sets only (a warm-up's weight says nothing about what to load).
    if (!countsForProgress(row.set_type)) continue;
    const name = row.session_exercises.exercise_name as string;
    const templateId = row.session_exercises.group_workout_exercise_id as string | null;
    const targets = templateId
      ? priorTargetByExerciseAndOrder.get(`${templateId}::${row.set_order}`)
      : undefined;
    const list = historyByExerciseName.get(name) ?? [];
    list.push({
      loggedAt: row.completed_at,
      weight: row.weight,
      targetReps: targets?.targetReps ?? null,
      targetRpe: targets?.targetRpe ?? row.rpe ?? null,
      targetRir: targets?.targetRir ?? row.rir ?? null,
    });
    historyByExerciseName.set(name, list);
  }

  const mediaByName = new Map<
    string,
    { videoPath: string | null; youtubeUrl: string | null; equipmentType: string | null }
  >();
  const demoLibrary: DemoRow[] = [];
  if (coachMembership) {
    const { data: libraryRows } = await supabase
      .from("exercise_library")
      .select("name, video_path, youtube_url, equipment_type")
      .eq("created_by", coachMembership.profile_id);
    for (const row of libraryRows ?? []) {
      mediaByName.set(row.name, {
        videoPath: row.video_path,
        youtubeUrl: row.youtube_url,
        equipmentType: row.equipment_type,
      });
      demoLibrary.push({ name: row.name, videoPath: row.video_path, youtubeUrl: row.youtube_url });
    }
  }

  const exercises: SessionExerciseEntry[] = await Promise.all(
    (sessionExercises ?? []).map(async (se: any) => {
      const media = mediaByName.get(se.exercise_name);
      // The demo is found by what the exercise is (a duplicate spelling or a second name for it), not only the exact text.
      const demo = findDemo(demoLibrary, se.exercise_name);
      let videoUrl: string | null = null;
      if (demo?.videoPath) {
        const { data } = await supabase.storage
          .from("exercise-media")
          .createSignedUrl(demo.videoPath, 3600);
        videoUrl = data?.signedUrl ?? null;
      }

      return {
        id: se.id,
        exerciseName: se.exercise_name,
        // the coach's name for it, only while the session exercise is still the program's exercise (a swap changes exercise_name, so a swapped one shows its own real name)
        displayName: se.group_workout_exercises && se.group_workout_exercises.exercise_name === se.exercise_name ? (se.group_workout_exercises.display_name ?? null) : null,
        exerciseOrder: se.exercise_order,
        isSwapped: se.is_swapped,
        isAdded: se.is_added,
        trackedFields: se.tracked_fields ?? DEFAULT_TRACKED_FIELDS,
        videoUrl,
        youtubeUrl: demo?.youtubeUrl ?? null,
        equipmentType: (media?.equipmentType as SessionExerciseEntry["equipmentType"]) ?? null,
        notes: se.group_workout_exercises?.notes ?? null,
        athleteNote: se.athlete_note ?? null,
        prescribedSetCount: se.group_workout_exercise_id ? prescribedSetCountByExercise.get(se.group_workout_exercise_id) ?? null : null,
        priorBest: priorBestByExerciseName.get(se.exercise_name) ?? {
          maxWeight: null,
          maxReps: null,
          maxVolume: null,
        },
        volumeHistory: volumeHistoryByExerciseName.get(se.exercise_name) ?? [],
        sets: (se.set_logs ?? [])
          .slice()
          .sort((a: any, b: any) => a.set_order - b.set_order)
          .map((sl: any) => {
            const target = se.group_workout_exercise_id
              ? targetsByExerciseAndOrder.get(`${se.group_workout_exercise_id}:${sl.set_order}`)
              : undefined;
            return {
              id: sl.id,
              setOrder: sl.set_order,
              setType: asSetType(setTypeById.get(sl.id)),
              weight: sl.weight,
              reps: sl.reps,
              rpe: sl.rpe,
              rir: sl.rir,
              tempo: sl.tempo,
              timeSeconds: sl.time_seconds,
              height: sl.height,
              distance: sl.distance,
              restSeconds: sl.rest_seconds,
              pace: sl.pace,
              status: sl.status,
              weightConfirmed: !!sl.weight_confirmed,
              dataFlag: (sl.data_flag as "unclear" | "accepted" | null) ?? null,
              dataFlagReason: (sl.data_flag_reason as string | null) ?? null,
              targetReps: target?.reps ?? null,
              targetWeight: target?.weight ?? null,
              targetRpe: target?.rpe ?? null,
              targetRir: target?.rir ?? null,
              targetTempo: target?.tempo ?? null,
              targetTimeSeconds: target?.timeSeconds ?? null,
              targetHeight: target?.height ?? null,
              targetDistance: target?.distance ?? null,
              targetRestSeconds: target?.restSeconds ?? null,
              targetRestMaxSeconds: target?.restMaxSeconds ?? null,
              targetPace: target?.pace ?? null,
              suggestedWeight:
                sl.weight == null
                  ? resolveWeightSuggestion(
                      findCorrelatingWeightSuggestion(
                        historyByExerciseName.get(se.exercise_name) ?? [],
                        target?.reps ?? null,
                        target?.rpe ?? null,
                        target?.rir ?? null
                      ),
                      target?.weight ?? null
                    )
                  : null,
            };
          }),
      };
    })
  );

  // "Last time" lookup: most recent completed set per exercise name, from any
  // other completed session belonging to this athlete.
  const exerciseNames = exercises.map((ex) => ex.exerciseName);
  const lastTimeByExercise: Record<string, { weight: number; reps: number }> = {};

  if (exerciseNames.length > 0) {
    const { data: priorSets } = await supabase
      .from("set_logs")
      .select(
        `
        weight, reps, completed_at,
        session_exercises!inner (
          exercise_name, session_id,
          athlete_sessions!inner ( athlete_id )
        )
      `
      )
      .in("session_exercises.exercise_name", exerciseNames)
      .eq("session_exercises.athlete_sessions.athlete_id", session.athlete_id)
      .neq("session_exercises.session_id", params.sessionId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false });

    for (const row of (priorSets ?? []) as any[]) {
      const name = row.session_exercises.exercise_name;
      if (!(name in lastTimeByExercise) && row.weight != null && row.reps != null) {
        lastTimeByExercise[name] = { weight: row.weight, reps: row.reps };
      }
    }
  }

  // Client-facing swap alternatives: for any exercise tagged with a
  // movement pattern, offer its ladder as quick-pick options — so an
  // athlete can self-substitute (machine taken, coach adjusting on the fly)
  // without needing the coach to intervene.
  const ladderByExercise: Record<string, string[]> = {};
  const patternIds = Array.from(
    new Set((sessionExercises ?? []).map((se: any) => se.movement_pattern_id).filter(Boolean))
  );

  if (patternIds.length > 0) {
    const { data: ladderRows } = await supabase
      .from("movement_pattern_exercises")
      .select("movement_pattern_id, exercise_name, difficulty_rank")
      .in("movement_pattern_id", patternIds)
      .order("difficulty_rank", { ascending: true });

    const ladderByPattern = new Map<string, string[]>();
    for (const row of ladderRows ?? []) {
      const list = ladderByPattern.get(row.movement_pattern_id) ?? [];
      list.push(row.exercise_name);
      ladderByPattern.set(row.movement_pattern_id, list);
    }

    for (const se of (sessionExercises ?? []) as any[]) {
      if (se.movement_pattern_id) {
        const ladder = ladderByPattern.get(se.movement_pattern_id);
        if (ladder) ladderByExercise[se.exercise_name] = ladder;
      }
    }
  }

  // Swipe-card carousel's coach-note-first callout (mobile_home_workout_
  // tab_merge_idea.md) — only ever the athlete's own opted-in notes;
  // RLS also enforces this independently, so a coach viewing this page
  // (in-person logging, View as Client) simply gets none, falling back
  // to the generic tip like any other exercise with no shared note.
  const coachNoteByExerciseName: Record<string, string | null> = {};
  if (isOwnSession) {
    await Promise.all(
      Array.from(new Set(exercises.map((ex) => ex.exerciseName))).map(async (name) => {
        const note = await findAthleteVisibleCoachNoteForExercise(supabase, {
          athleteId: session.athlete_id,
          groupId: session.group_id,
          exerciseName: name,
        });
        coachNoteByExerciseName[name] = note?.body ?? null;
      })
    );
  }

  // Pending-task gating (custom_shape_theming_idea.md) — a real due habit
  // or an unanswered wellness check-in becomes the unlock key for this
  // rest period's mini-game/trivia, rather than a nudge running alongside
  // it freely. Only ever computed for the athlete's own session (a coach
  // logging a client's session in-person sees no gate) and only when
  // something is genuinely pending today — never invented to fill space.
  // The coach's calendar day, like Home, not the server's UTC day, which flips to tomorrow in the evening.
  const todayKey = dateKeyInZone(await getGroupCoachTimezone(supabase, session.group_id));
  let pendingGateTask: PendingGateTask | null = null;
  if (isOwnSession && session.status === "in_progress") {
    const [{ data: habitRows }, { data: wellnessRow }] = await Promise.all([
      supabase
        .from("client_habits")
        .select("id, title, weekdays")
        .eq("athlete_id", session.athlete_id)
        .eq("group_id", session.group_id)
        .eq("active", true),
      supabase
        .from("wellness_checkins")
        .select("id")
        .eq("athlete_id", session.athlete_id)
        .eq("log_date", todayKey)
        // One check-in per person per day, whichever group it was answered in.
        .limit(1)
        .maybeSingle(),
    ]);
    const todayForWeekday = new Date(`${todayKey}T00:00:00`);
    const dueHabits = (habitRows ?? []).filter((h) => isHabitDueOn(h.weekdays, todayForWeekday));
    if (dueHabits.length > 0) {
      const { data: logRows } = await supabase
        .from("habit_logs")
        .select("habit_id, completed_at")
        .in("habit_id", dueHabits.map((h) => h.id))
        .eq("log_date", todayKey);
      const completedIds = new Set((logRows ?? []).filter((l) => l.completed_at).map((l) => l.habit_id));
      const firstPending = dueHabits.find((h) => !completedIds.has(h.id));
      if (firstPending) {
        pendingGateTask = { kind: "habit", habitId: firstPending.id, title: firstPending.title };
      }
    }
    if (!pendingGateTask && !wellnessRow) {
      pendingGateTask = { kind: "wellness" };
    }
  }

  // Read during rest: only the athlete's own in-progress session (a coach logging for a client holds the phone, not the person resting), and only when it is switched on for them.
  let read: ReadForViewer | null = null;
  if (isOwnSession && session.status === "in_progress") {
    read = await getReadForViewer(supabase, session.group_id, user.id, todayKey);
  }

  // A coach logging this session FOR the client (not the client's own login): the coach-mode frame, with the coach's hub and one tap home, and nothing posted in the name of a client under 18.
  const coachModeFor = session.logged_by_coach && !isOwnSession && viewerIsCoach;
  const coachModeClient = coachModeFor
    ? {
        name: ((await supabase.from("profiles").select("full_name").eq("id", session.athlete_id).maybeSingle()).data as { full_name?: string | null } | null)?.full_name ?? "this client",
        isMinor: await athleteIsMinor(supabase, session.athlete_id),
      }
    : null;
  const coachHomeHref = `/groups/${session.group_id}`;
  // A coach logging for a client goes Back to that client's log overview (their day), still in coach mode. The group's workout page is the coach's own template view: for most one-on-one clients it says
  // "This workout isn't available" and its Go to Home leaves coach mode (Oct 19 audit).
  const backHref = sessionBackHref({ groupId: session.group_id, athleteId: session.athlete_id, workoutId: session.workout_id, coachMode: !!coachModeClient });

  return (
    <main className={`min-h-screen overflow-x-clip bg-graphite text-chalk font-body ${session.status === "in_progress" ? "pb-16" : "pb-32"}`}>
      {coachModeClient && <CoachModeBar groupId={session.group_id} clientName={coachModeClient.name} homeHref={coachHomeHref} />}
      <header className={session.status === "in_progress" ? "relative px-5 pt-1 pb-1 border-b border-steel/20" : "px-5 pt-8 pb-6 border-b border-steel/20"}>
        {/* In progress is ONE slim row (Back, the day, who logged it) so the exercise card keeps the screen; a finished or paused workout keeps the roomier header. */}
        {session.status === "in_progress" ? (
          <div className="flex items-center justify-between gap-2">
            <ExitWorkoutButton sessionId={session.id} backHref={backHref} />
            <h1 className="font-display font-bold text-lg leading-none uppercase truncate min-w-0 flex-1 text-center">{(session as any).workouts?.title ?? "Workout"}</h1>
            {session.logged_by_coach && !isOwnSession ? (
              <SendToClientButton athleteId={session.athlete_id} sessionId={session.id} workoutTitle={(session as any).workouts?.title ?? "Workout"} compact />
            ) : session.logged_by_coach ? (
              <CoachLoggedBadge />
            ) : (
              <span className="w-12 shrink-0" aria-hidden="true" />
            )}
          </div>
        ) : (
          <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
            &larr; Back
          </Link>
        )}
        {session.status !== "in_progress" && (
          <div className="flex items-center justify-between mt-3">
            <p className="font-body text-xs text-steel uppercase tracking-wide shrink-0">
              {session.status === "completed" ? "Completed" : session.status === "abandoned" ? (pausedRecently ? "Paused" : "Not finished") : "In progress"}
            </p>
            {session.logged_by_coach && <CoachLoggedBadge />}
          </div>
        )}
        {session.status !== "in_progress" && (
          <h1 className="font-display font-bold text-3xl leading-none mt-1 uppercase">
            {(session as any).workouts?.title ?? "Workout"}
          </h1>
        )}
        {/* Coach-only, mid-logging escape hatch — Ron's own real scenario:
            ran out of time in person and needed a quick way to hand the
            rest off. The client can already resume this exact session
            the moment they open it themselves (existingSession handles
            that); this just makes sure they know to. */}
        {workoutCardHref && (
          <Link href={workoutCardHref} className="inline-flex items-center min-h-11 mt-3 font-body text-sm text-rust underline underline-offset-2">
            View workout card &rarr;
          </Link>
        )}
      </header>

      <LiftUnitProvider unit={await loadLiftUnit(supabase, session.athlete_id)}>
      <SessionLogger
        sessionId={session.id}
        isCompleted={session.status !== "in_progress"}
        initialExercises={exercises}
        lastTimeByExercise={lastTimeByExercise}
        ladderByExercise={ladderByExercise}
        raised={isOwnSession}
        finishedLine={session.status === "completed" ? "Done. Good workout." : null}
        pausedSessionId={session.status === "abandoned" ? session.id : null}
        coachMode={coachModeClient ? { homeHref: coachHomeHref, clientIsMinor: coachModeClient.isMinor } : undefined}
        groupId={session.group_id}
        athleteId={session.athlete_id}
        viewerId={user.id}
        canUploadVideo={canUploadVideo}
        startedAt={session.started_at}
        gamificationEnabled={gamificationEnabled}
        postWorkoutCards={postWorkoutCards}
        pendingGateTask={pendingGateTask}
        todayDate={todayKey}
        coachNoteByExerciseName={coachNoteByExerciseName}
        exerciseSwipeDirection={exerciseSwipeDirection}
        demoLibrary={demoLibrary}
        read={read}
      />
      </LiftUnitProvider>

      {isOwnSession && (
        <BottomTabBar groupId={session.group_id} activeOverride="home" />
      )}
    </main>
  );
}
