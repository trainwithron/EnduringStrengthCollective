"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { notifyPush } from "@/lib/push-notify";
import { isHighPriorityClient } from "@/lib/notification-priority";

// This project has no generated Supabase Database type, so a fresh RPC's
// result falls back to an untyped shape — spelled out explicitly here
// since the code below reads several fields off it.
interface CompleteWorkoutResult {
  workout_log_id: string;
  athlete_id: string;
  group_id: string;
  total_volume: number;
  total_sets_completed: number;
  new_prs: string[];
}

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
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleTap() {
    if (!allSetsResolved) {
      setConfirming(true);
      return;
    }
    handleComplete();
  }

  async function handleComplete() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();

    // All the real work — marking the session completed and computing
    // volume/sets/PRs from the actual set_logs rows — happens server-side
    // in this one atomic RPC now, so there's nothing for a modified
    // request to fabricate: the numbers are never client-supplied.
    const { data: result, error: completeError } = (await supabase
      .rpc("complete_workout_session", { p_session_id: sessionId })
      .single()) as { data: CompleteWorkoutResult | null; error: { message: string } | null };

    if (completeError || !result) {
      setError("Couldn't complete this workout — try again.");
      setSubmitting(false);
      return;
    }

    const [{ data: athleteProfile }, { data: athleteMembership }] = await Promise.all([
      supabase.from("profiles").select("feed_broadcast_level, full_name").eq("id", result.athlete_id).maybeSingle(),
      supabase
        .from("group_memberships")
        .select("client_tier")
        .eq("group_id", result.group_id)
        .eq("profile_id", result.athlete_id)
        .maybeSingle(),
    ]);
    const broadcastLevel = athleteProfile?.feed_broadcast_level ?? "full";
    const newPrs = result.new_prs ?? [];

    // A 1-on-1 client's own training is exactly the "notify promptly"
    // case from the priority-tiers design — a big/online-tier group's
    // routine completions stay off the coach's push channel entirely,
    // on purpose (see lib/notification-priority.ts).
    if (isHighPriorityClient(athleteMembership?.client_tier ?? null)) {
      const { data: coachMembership } = await supabase
        .from("group_memberships")
        .select("profile_id")
        .eq("group_id", result.group_id)
        .eq("role", "coach")
        .limit(1)
        .maybeSingle();
      if (coachMembership) {
        const athleteName = athleteProfile?.full_name ?? "Your client";
        const prSuffix = newPrs.length > 0 ? " — new PR! 🎉" : "";
        notifyPush(
          coachMembership.profile_id,
          "Workout logged",
          `${athleteName} completed a workout${prSuffix}`,
          `/groups/${result.group_id}/athletes/${result.athlete_id}`
        );
      }
    }

    // The athlete's own broadcast preference is captured onto the post
    // itself — not just read live — so the card renders consistently even
    // if they change this setting later.
    const shouldPost =
      broadcastLevel !== "private" && !(broadcastLevel === "prs_only" && newPrs.length === 0);
    // A "checkin only" post never reveals PR content, so it never belongs
    // in the PR Board channel even when a PR genuinely happened.
    const channel = broadcastLevel !== "checkin_only" && newPrs.length > 0 ? "pr_board" : "general";

    let postId: string | null = null;
    if (shouldPost) {
      const { data: post } = await supabase
        .from("posts")
        .insert({
          group_id: result.group_id,
          author_id: result.athlete_id,
          post_type: "workout_summary",
          workout_log_id: result.workout_log_id,
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
    router.push(postId ? `/share/${postId}` : `/groups/${result.group_id}`);
  }

  return (
    <div
      className={`fixed ${
        raised ? "bottom-16" : "bottom-0"
      } left-0 right-0 bg-graphite border-t border-steel/20 px-5 py-4`}
    >
      {confirming && (
        <div className="mb-3 p-3 border border-rust/40 bg-surface/60">
          <p className="font-body text-sm text-chalk">
            This workout isn&apos;t fully filled in — finish it anyway?
          </p>
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                handleComplete();
              }}
              disabled={submitting}
              className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {submitting ? "Finishing…" : "Finish workout"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={submitting}
              className="h-10 px-4 border border-steel/30 text-steel font-body text-sm"
            >
              Keep going
            </button>
          </div>
          <p className="font-body text-[11px] text-steel mt-2">
            Everything you&apos;ve already entered is saved either way.
          </p>
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust mb-2 text-center" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleTap}
        disabled={disabled || submitting}
        className="w-full h-14 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
      >
        {submitting ? "Finishing…" : "Complete workout"}
      </button>
    </div>
  );
}
