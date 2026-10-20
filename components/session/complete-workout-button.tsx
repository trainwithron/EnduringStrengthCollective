"use client";

import { useEffect, useState } from "react";
import { WORKOUT_CHOICE_EVENT } from "@/lib/workout-choice";
import { createBrowserClient } from "@/lib/supabase/client";
import { saved } from "@/lib/saved";
import { localDateKey } from "@/lib/timezone";
import { useSetSave } from "@/components/logging/set-save-context";
import { useRouter } from "next/navigation";
import { notifyPush } from "@/lib/push-notify";
import { isHighPriorityClient } from "@/lib/notification-priority";
import { checkAndNotifyLowSessionBalance } from "@/lib/notify-low-session-balance";
import { notifyWebhookEvent } from "@/lib/notify-webhook-event";
import { refreshEquipmentLoadRatios } from "@/lib/equipment-load-ratio-gather";
import { announceWorkoutLog } from "@/lib/announce-workout-log";
import { useLiftUnit } from "@/components/logging/lift-unit-context";
import { liftUnitLabel } from "@/lib/lift-weight";
import { parseWeightInput } from "@/lib/units";

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
  completedSetCount,
  disabled,
  raised,
  coachMode,
  pauseHref,
  postWorkoutCards = true,
}: {
  sessionId: string;
  // Where "Pause for now" goes (the person's Home, or the coach's Home when logging for a client).
  pauseHref: string;
  allSetsResolved: boolean;
  // Sets marked done so far. With none, Complete asks "No sets are logged yet. Complete anyway?" once, so a stray tap does not finish, post and notify an empty workout.
  completedSetCount?: number;
  disabled: boolean;
  raised?: boolean;
  // Set when a coach is logging this session FOR a client (not the client's own login): finishing goes straight back to the coach's home instead of the client's share card, and
  // no feed post is made in the name of a client under 18.
  coachMode?: { homeHref: string; clientIsMinor: boolean };
  // The group's "Post-workout cards and PR notices" setting (off: no feed card, no share card).
  postWorkoutCards?: boolean;
}) {
  const liftUnit = useLiftUnit();
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [emptyAsked, setEmptyAsked] = useState(false);
  // "Delete workout" asks once: "Delete this workout? Nothing is saved and no session is used."
  const [deleteAsked, setDeleteAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // The on-screen Back and the phone's own back gesture open this same choice (complete, pause, or keep going) instead of leaving. The page keeps one extra history step while the workout is open so the
  // gesture lands here; the step is dropped again when this unmounts.
  useEffect(() => {
    function open() {
      setConfirming(true);
    }
    function guard() {
      window.history.pushState({ workoutGuard: true }, "");
      setConfirming(true);
    }
    window.addEventListener(WORKOUT_CHOICE_EVENT, open);
    window.history.pushState({ workoutGuard: true }, "");
    window.addEventListener("popstate", guard);
    return () => {
      window.removeEventListener(WORKOUT_CHOICE_EVENT, open);
      window.removeEventListener("popstate", guard);
    };
  }, []);

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

  // Post-session RPE (half_finished_ideas_full_audit.md #18, greenlit by
  // Ron as a single post-session one-tap prompt, not per-set averaged
  // RPE) — the flagship training-load signal. Shown first, before the
  // weight nudge, for the same own-session-only reason: it's the
  // athlete's own subjective read on the session that just ended, so a
  // coach logging a client's in-person session never sees it.
  const [rpeNudge, setRpeNudge] = useState<{ athleteId: string; groupId: string; navHref: string } | null>(null);
  const [rpeSubmitting, setRpeSubmitting] = useState(false);

  const { flush: flushSets } = useSetSave();

  function finishNavigation(navHref: string) {
    router.push(navHref);
  }

  async function handleLogWeight() {
    if (!weightNudge) return;
    // Typed in the unit this person uses; saved as pounds (the stored unit), so a kilogram client is not saved as a much lighter body weight.
    const value = parseWeightInput(weightValue, liftUnit);
    if (!value || value <= 0) {
      finishNavigation(weightNudge.navHref);
      return;
    }
    setWeightSubmitting(true);
    const supabase = createBrowserClient();
    const weightSaved = await saved(supabase.from("body_weight_logs").upsert(
      {
        athlete_id: weightNudge.athleteId,
        group_id: weightNudge.groupId,
        logged_date: localDateKey(),
        weight: value,
      },
      { onConflict: "athlete_id,logged_date" }
    ));
    setWeightSubmitting(false);
    // A failed save keeps the person on this prompt with the number they typed (Save to try again, Skip to move on); only a saved weight moves on.
    if (!weightSaved) return;
    finishNavigation(weightNudge.navHref);
  }

  // Tapping the button opens the choice: complete the workout (whatever is filled in is saved, empty fields stay empty) or pause it for later.
  function handleTap() {
    setConfirming(true);
  }

  async function handlePause() {
    setSubmitting(true);
    const supabase = createBrowserClient();
    await flushSets();
    // A failed pause keeps the person here (the workout is still in progress), instead of leaving as if it were paused.
    if (!(await saved(supabase.from("athlete_sessions").update({ status: "abandoned" }).eq("id", sessionId).eq("status", "in_progress")))) {
      setSubmitting(false);
      return;
    }
    router.push(pauseHref);
  }

  // A workout started by mistake goes away completely: only while it is still in progress (never a finished one), and nothing else is touched (a booked
  // session stays booked; no session is used, because a session is only used when a workout is completed). Then it leaves the way Pause does.
  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    const { data, error: deleteError } = await createBrowserClient().from("athlete_sessions").delete().eq("id", sessionId).eq("status", "in_progress").select("id");
    if (deleteError || !data || data.length === 0) {
      setError("This workout couldn't be deleted. Nothing was changed.");
      setSubmitting(false);
      setDeleteAsked(false);
      return;
    }
    router.push(pauseHref);
  }

  async function handleComplete() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();

    // Anything still waiting to save (a bad gym signal) must land BEFORE we
    // total the workout — the server counts only what's actually saved.
    const allSaved = await flushSets();
    if (!allSaved) {
      setError("Some changes (a set or a note) haven't saved yet — check your signal, then tap Complete again. Nothing you entered is lost.");
      setSubmitting(false);
      return;
    }

    // A lost response followed by another tap must not complete (and post,
    // notify, deduct) a second time: if this session is already completed,
    // just take them to the card it already has.
    const { data: existingSession } = await supabase
      .from("athlete_sessions")
      .select("status, group_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (existingSession?.status === "completed") {
      const { data: existingLog } = await supabase
        .from("workout_logs")
        .select("id")
        .eq("session_id", sessionId)
        .maybeSingle();
      const { data: existingPost } = existingLog
        ? await supabase
            .from("posts")
            .select("id")
            .eq("workout_log_id", existingLog.id)
            .eq("post_type", "workout_summary")
            .maybeSingle()
        : { data: null };
      finishNavigation(existingPost ? `/share/${existingPost.id}` : coachMode ? coachMode.homeHref : `/groups/${existingSession.group_id}`);
      return;
    }

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

    // Session Pattern Spotter
    // (habit_spotter_and_post_workout_coach_page_research_sept19.md) —
    // same fire-and-forget, never-blocks-completion shape as the
    // equipment-load-ratio refresh above. The route itself resolves the
    // coach, runs the real detectors, and only notifies when it
    // actually finds something.
    fetch("/api/session-pattern-check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, athleteId: result.athlete_id, groupId: result.group_id }),
    }).catch(() => {});

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

    // The feed card (the athlete's own sharing choice is kept on the post) and the link to the celebratory share card: one shared function, also used when a client agrees to count a record from
    // imported history (lib/announce-workout-log.ts). Everyone who finishes a workout gets the workout card, a coach logging for a client included (to share or text to them; the client finds it in their history). A coach logging for a client under 18 posts nothing to the feed, but still gets the card; back to the coach's home only if the card cannot be made.
    const cardsOn = postWorkoutCards;
    const announced = await announceWorkoutLog(supabase, {
      workoutLogId: result.workout_log_id,
      athleteId: result.athlete_id,
      groupId: result.group_id,
      broadcastLevel,
      hasPrs: newPrs.length > 0,
      // No feed card and no share card when the group has them switched off.
      skipPost: !cardsOn || !!coachMode?.clientIsMinor,
      skipLink: !cardsOn,
    });

    // Every completed workout gets a celebratory, shareable card instead of silently landing back on the group hub.
    let navHref = `/groups/${result.group_id}`;
    if (announced.href) navHref = announced.href;
    else if (coachMode) navHref = coachMode.homeHref;

    // RPE comes first (own-session only, same reasoning as the weight
    // nudge below — it's the athlete's own subjective read on the session
    // that just ended). Once it's submitted/skipped,
    // checkWeightThenNavigate below carries on to the existing
    // weight-nudge-or-navigate logic.
    if (raised) {
      setRpeNudge({ athleteId: result.athlete_id, groupId: result.group_id, navHref });
      setSubmitting(false);
      return;
    }

    finishNavigation(navHref);
  }

  async function checkWeightThenNavigate(athleteId: string, groupId: string, navHref: string) {
    const supabase = createBrowserClient();
    const todayKey = localDateKey();
    const { data: todayLog } = await supabase
      .from("body_weight_logs")
      .select("id")
      .eq("athlete_id", athleteId)
      .eq("logged_date", todayKey)
      .maybeSingle();
    if (!todayLog) {
      setWeightNudge({ athleteId, groupId, navHref });
      return;
    }
    finishNavigation(navHref);
  }

  async function handleSubmitRpe(value: number) {
    if (!rpeNudge) return;
    setRpeSubmitting(true);
    const supabase = createBrowserClient();
    const rpeSaved = await saved(supabase.from("athlete_sessions").update({ session_rpe: value }).eq("id", sessionId));
    setRpeSubmitting(false);
    // A failed save keeps the person on the rating prompt (tap again to try again, Skip to move on).
    if (!rpeSaved) return;
    const { athleteId, groupId, navHref } = rpeNudge;
    setRpeNudge(null);
    await checkWeightThenNavigate(athleteId, groupId, navHref);
  }

  async function handleSkipRpe() {
    if (!rpeNudge) return;
    const { athleteId, groupId, navHref } = rpeNudge;
    setRpeNudge(null);
    await checkWeightThenNavigate(athleteId, groupId, navHref);
  }

  if (rpeNudge) {
    return (
      <div
        data-complete-bar
        className={`fixed ${
          raised ? "bottom-16" : "bottom-0"
        } left-0 right-0 bg-graphite border-t border-steel/20 px-5 py-2`}
      >
        <p className="font-body text-sm text-chalk mb-2">How hard was that whole session? (1-10)</p>
        <div className="grid grid-cols-5 gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`Session RPE: ${n} of 10${n === 1 ? " (Easy)" : n === 10 ? " (All-out)" : ""}`}
              onClick={() => handleSubmitRpe(n)}
              disabled={rpeSubmitting}
              className="h-11 border border-steel/30 text-chalk font-body text-sm active:bg-rust active:border-rust active:text-graphite disabled:opacity-40"
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="font-body text-xs text-steel">Easy</span>
          <span className="font-body text-xs text-steel">All-out</span>
        </div>
        <button
          type="button"
          onClick={handleSkipRpe}
          disabled={rpeSubmitting}
          className="w-full h-11 mt-2 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
        >
          {rpeSubmitting ? "Saving…" : "Skip"}
        </button>
      </div>
    );
  }

  if (weightNudge) {
    return (
      <div
        data-complete-bar
        className={`fixed ${
          raised ? "bottom-16" : "bottom-0"
        } left-0 right-0 bg-graphite border-t border-steel/20 px-5 py-2`}
      >
        <p className="font-body text-sm text-chalk mb-2">Log today&apos;s weight while you&apos;re here?</p>
        <div className="flex items-center gap-2">
          <input aria-label={`Weight (${liftUnitLabel(liftUnit)})`}
            type="number"
            inputMode="decimal"
            step="0.1"
            autoFocus
            value={weightValue}
            onChange={(e) => setWeightValue(e.target.value)}
            placeholder={`Weight (${liftUnitLabel(liftUnit)})`}
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
      data-complete-bar
      className={`fixed ${
        raised ? "bottom-16" : "bottom-0"
      } left-0 right-0 bg-graphite border-t border-steel/20 px-5 py-2`}
    >
      {confirming && deleteAsked && (
        <div className="mb-3 p-3 border border-rust/40 bg-surface/60" data-delete-workout-confirm>
          <p className="font-body text-sm text-chalk">Delete this workout? Nothing is saved and no session is used.</p>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={submitting}
              className="h-11 px-4 border border-rust text-rust font-body text-sm font-medium disabled:opacity-40"
            >
              {submitting ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => setDeleteAsked(false)}
              disabled={submitting}
              className="h-11 px-3 border border-steel/30 text-steel font-body text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {confirming && !deleteAsked && (
        <div className="mb-3 p-3 border border-rust/40 bg-surface/60">
          <p className="font-body text-sm text-chalk">
            {emptyAsked ? "No sets are logged yet. Complete anyway?" : "Complete this workout, or pause it and pick it up later."}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <button
              type="button"
              onClick={() => {
                // Nothing is marked done yet: ask once more, deliberately, before finishing an empty workout.
                if (completedSetCount === 0 && !emptyAsked) {
                  setEmptyAsked(true);
                  return;
                }
                setConfirming(false);
                setEmptyAsked(false);
                handleComplete();
              }}
              disabled={submitting}
              className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {submitting ? "Finishing…" : emptyAsked ? "Complete anyway" : "Complete workout"}
            </button>
            <button
              type="button"
              onClick={() => void handlePause()}
              disabled={submitting}
              className="h-11 px-4 border border-rust text-rust font-body text-sm font-medium disabled:opacity-40"
            >
              Pause for now
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setEmptyAsked(false);
              }}
              disabled={submitting}
              className="h-11 px-3 border border-steel/30 text-steel font-body text-sm"
            >
              Keep going
            </button>
            <button
              type="button"
              onClick={() => {
                setEmptyAsked(false);
                setDeleteAsked(true);
              }}
              disabled={submitting}
              className="h-11 px-1 font-body text-xs text-steel underline underline-offset-2 sm:ml-auto"
            >
              Delete workout
            </button>
          </div>
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
        className="w-full h-12 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
      >
        {submitting ? "Finishing…" : "Complete workout"}
      </button>
    </div>
  );
}
