"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function CompleteWorkoutButton({
  sessionId,
  allSetsResolved,
  disabled,
  raised,
}: {
  sessionId: string;
  allSetsResolved: boolean;
  disabled: boolean;
  raised?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleComplete() {
    setSubmitting(true);
    const supabase = createBrowserClient();

    const { data: session } = await supabase
      .from("athlete_sessions")
      .select("id, group_id, athlete_id, workout_id, started_at, logged_by_coach")
      .eq("id", sessionId)
      .single();

    if (!session) {
      setSubmitting(false);
      return;
    }

    const completedAt = new Date();
    const durationSeconds = Math.round(
      (completedAt.getTime() - new Date(session.started_at).getTime()) / 1000
    );

    await supabase
      .from("athlete_sessions")
      .update({
        status: "completed",
        completed_at: completedAt.toISOString(),
        duration_seconds: durationSeconds,
      })
      .eq("id", sessionId);

    // Pull this session's completed sets, joined to exercise name.
    const { data: currentSets } = await supabase
      .from("set_logs")
      .select(
        "weight, reps, status, session_exercises!inner ( session_id, exercise_name )"
      )
      .eq("session_exercises.session_id", sessionId);

    const completedLogs = (currentSets ?? []).filter((s) => s.status === "completed");
    const totalVolume = completedLogs.reduce(
      (sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0),
      0
    );
    const totalSetsCompleted = completedLogs.length;

    // This session's best weight per exercise name.
    const sessionBestByExercise = new Map<string, number>();
    for (const log of completedLogs) {
      const name = (log as any).session_exercises.exercise_name;
      const weight = log.weight ?? 0;
      if (!sessionBestByExercise.has(name) || weight > sessionBestByExercise.get(name)!) {
        sessionBestByExercise.set(name, weight);
      }
    }

    const exerciseNames = Array.from(sessionBestByExercise.keys());
    let newPrs: string[] = [];

    if (exerciseNames.length > 0) {
      // All-time best weight per exercise name, from every OTHER completed session.
      const { data: priorSets } = await supabase
        .from("set_logs")
        .select(
          `
          weight, status,
          session_exercises!inner (
            exercise_name, session_id,
            athlete_sessions!inner ( athlete_id )
          )
        `
        )
        .in("session_exercises.exercise_name", exerciseNames)
        .eq("session_exercises.athlete_sessions.athlete_id", session.athlete_id)
        .neq("session_exercises.session_id", sessionId)
        .eq("status", "completed");

      const priorBestByExercise = new Map<string, number>();
      for (const row of priorSets ?? []) {
        const name = (row as any).session_exercises.exercise_name;
        const weight = row.weight ?? 0;
        if (!priorBestByExercise.has(name) || weight > priorBestByExercise.get(name)!) {
          priorBestByExercise.set(name, weight);
        }
      }

      newPrs = exerciseNames.filter((name) => {
        const sessionBest = sessionBestByExercise.get(name)!;
        const priorBest = priorBestByExercise.get(name);
        // No prior history at all = first-time lift, not a "PR" in the exciting sense.
        // Only counts if there IS a prior best and it's been beaten.
        return priorBest !== undefined && sessionBest > priorBest;
      });
    }

    const { data: workoutLog } = await supabase
      .from("workout_logs")
      .insert({
        session_id: sessionId,
        athlete_id: session.athlete_id,
        group_id: session.group_id,
        workout_id: session.workout_id,
        total_duration_seconds: durationSeconds,
        total_volume: totalVolume,
        total_sets_completed: totalSetsCompleted,
        new_prs: newPrs,
        logged_by_coach: session.logged_by_coach,
      })
      .select("id")
      .single();

    // The athlete's own broadcast preference — captured onto the post
    // itself (not just read live) so the card renders consistently even
    // if they change this setting later.
    const { data: athleteProfile } = await supabase
      .from("profiles")
      .select("feed_broadcast_level")
      .eq("id", session.athlete_id)
      .maybeSingle();
    const broadcastLevel = athleteProfile?.feed_broadcast_level ?? "full";

    const shouldPost =
      broadcastLevel !== "private" && !(broadcastLevel === "prs_only" && newPrs.length === 0);
    // A "checkin only" post never reveals PR content, so it never belongs
    // in the PR Board channel even when a PR genuinely happened.
    const channel = broadcastLevel !== "checkin_only" && newPrs.length > 0 ? "pr_board" : "general";

    let postId: string | null = null;
    if (workoutLog && shouldPost) {
      const { data: post } = await supabase
        .from("posts")
        .insert({
          group_id: session.group_id,
          author_id: session.athlete_id,
          post_type: "workout_summary",
          workout_log_id: workoutLog.id,
          channel,
          broadcast_level: broadcastLevel === "private" ? "full" : broadcastLevel,
        })
        .select("id")
        .single();
      postId = post?.id ?? null;
    }

    // Every completed workout gets a celebratory, shareable card instead of
    // silently landing back on the group hub — that's the actual feedback
    // moment a client (or a coach logging in-person) gets after finishing.
    router.push(postId ? `/share/${postId}` : `/groups/${session.group_id}`);
  }

  return (
    <div
      className={`fixed ${
        raised ? "bottom-16" : "bottom-0"
      } left-0 right-0 bg-graphite border-t border-steel/20 px-5 py-4`}
    >
      <button
        type="button"
        onClick={handleComplete}
        disabled={disabled || submitting}
        className="w-full h-14 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
      >
        {submitting
          ? "Finishing…"
          : allSetsResolved
          ? "Complete workout"
          : "Finish remaining sets to complete"}
      </button>
    </div>
  );
}
