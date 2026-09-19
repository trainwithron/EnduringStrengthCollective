"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { notifyPush } from "@/lib/push-notify";
import { isHighPriorityClient } from "@/lib/notification-priority";
import { checkAndNotifyLowSessionBalance } from "@/lib/notify-low-session-balance";
import { notifyWebhookEvent } from "@/lib/notify-webhook-event";
import { refreshEquipmentLoadRatios } from "@/lib/equipment-load-ratio-gather";

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
  // Group record book (record_holders_hall_of_fame_scoping memory) —
  // weight-only for now, computed alongside the existing personal-PR
  // check inside the same RPC. Exercise names that just became the
  // group's new all-time-best weight, distinct from newPrs (a personal
  // best) — an exercise can be both at once.
  new_records: string[];
  // gym_owner_multi_trainer_session_tracking_real_prospect.md — true
  // only when this was a coach-logged (in-person/walk-in) session AND a
  // session_credits row already existed to spend from. An athlete's own
  // self-completed workout never sets this.
  credit_consumed: boolean;
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

  // Post-workout weight-log nudge — prompted right after "Complete
  // Workout" is tapped (not mid-rest), since the athlete is likely still
  // at the gym near a scale at that exact moment. Only for the athlete's
  // own session (raised === isOwnSession, same signal already used for
  // the bar's bottom offset) and only when they haven't already logged
  // today — never a nag on a day they've already done it.
  const [weightNudge, setWeightNudge] = useState<{ athleteId: string; groupId: string; navHref: string } | null>(
    null
  );
  const [weightValue, setWeightValue] = useState("");
  const [weightSubmitting, setWeightSubmitting] = useState(false);

  function finishNavigation(navHref: string) {
    router.push(navHref);
  }

  async function handleLogWeight() {
    if (!weightNudge) return;
    const value = Number(weightValue);
    if (!value || value <= 0) {
      finishNavigation(weightNudge.navHref);
      return;
    }
    setWeightSubmitting(true);
    const supabase = createBrowserClient();
    await supabase.from("body_weight_logs").upsert(
      {
        athlete_id: weightNudge.athleteId,
        group_id: weightNudge.groupId,
        logged_date: new Date().toISOString().slice(0, 10),
        weight: value,
      },
      { onConflict: "athlete_id,logged_date" }
    );
    setWeightSubmitting(false);
    finishNavigation(weightNudge.navHref);
  }

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

    if (result.credit_consumed) {
      checkAndNotifyLowSessionBalance(result.athlete_id, result.group_id);
    }

    // Zapier triggers (zapier_integration_queued_sept16.md) — fired for
    // every completion, plus a separate pr_hit for a coach who only
    // wants to hear about the PRs specifically, not every workout.
    notifyWebhookEvent(result.group_id, "workout_completed", {
      athleteId: result.athlete_id,
      workoutLogId: result.workout_log_id,
      totalVolume: result.total_volume,
      totalSetsCompleted: result.total_sets_completed,
    });
    if ((result.new_prs ?? []).length > 0) {
      notifyWebhookEvent(result.group_id, "pr_hit", {
        athleteId: result.athlete_id,
        workoutLogId: result.workout_log_id,
        exercises: result.new_prs,
      });
    }

    const [{ data: athleteProfile }, { data: athleteMembership }, { data: workoutCoach }] = await Promise.all([
      supabase.from("profiles").select("feed_broadcast_level, full_name").eq("id", result.athlete_id).maybeSingle(),
      supabase
        .from("group_memberships")
        .select("client_tier")
        .eq("group_id", result.group_id)
        .eq("profile_id", result.athlete_id)
        .maybeSingle(),
      supabase
        .from("group_memberships")
        .select("profile_id")
        .eq("group_id", result.group_id)
        .eq("role", "coach")
        .limit(1)
        .maybeSingle(),
    ]);
    const broadcastLevel = athleteProfile?.feed_broadcast_level ?? "full";

    // Equipment-variant load-ratio learning
    // (equipment_variant_load_ratio_and_smart_swap_scoping_sept19.md) —
    // "this swap's own logged sets become the seed data for the next
    // occurrence." Fire-and-forget, same as the other post-completion
    // side effects here: a real recompute over this athlete's full
    // history, but never something the athlete waits on or that can
    // fail the completion flow itself.
    if (workoutCoach?.profile_id) {
      refreshEquipmentLoadRatios(supabase, { athleteId: result.athlete_id, coachId: workoutCoach.profile_id }).catch(
        () => {}
      );
    }
    const newPrs = result.new_prs ?? [];
    const newRecords = result.new_records ?? [];

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
        const prSuffix =
          newRecords.length > 0 ? " — new GROUP RECORD! 🏆" : newPrs.length > 0 ? " — new PR! 🎉" : "";
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
    const navHref = postId ? `/share/${postId}` : `/groups/${result.group_id}`;

    // Only for the athlete's own session (raised is set to isOwnSession by
    // the caller) and only when today's weight hasn't already been logged.
    if (raised) {
      const todayKey = new Date().toISOString().slice(0, 10);
      const { data: todayLog } = await supabase
        .from("body_weight_logs")
        .select("id")
        .eq("athlete_id", result.athlete_id)
        .eq("logged_date", todayKey)
        .maybeSingle();
      if (!todayLog) {
        setWeightNudge({ athleteId: result.athlete_id, groupId: result.group_id, navHref });
        setSubmitting(false);
        return;
      }
    }

    finishNavigation(navHref);
  }

  if (weightNudge) {
    return (
      <div
        className={`fixed ${
          raised ? "bottom-16" : "bottom-0"
        } left-0 right-0 bg-graphite border-t border-steel/20 px-5 py-4`}
      >
        <p className="font-body text-sm text-chalk mb-2">Log today&apos;s weight while you&apos;re here?</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            autoFocus
            value={weightValue}
            onChange={(e) => setWeightValue(e.target.value)}
            placeholder="Weight (lbs)"
            className="flex-1 h-11 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
          />
          <button
            type="button"
            onClick={handleLogWeight}
            disabled={weightSubmitting}
            className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            {weightSubmitting ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => finishNavigation(weightNudge.navHref)}
            disabled={weightSubmitting}
            className="h-11 px-3 border border-steel/30 text-steel font-body text-sm"
          >
            Skip
          </button>
        </div>
      </div>
    );
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
