"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { computeNewlyCrossedThresholds } from "@/lib/transformation-milestones";

export interface WeightLogEntry {
  id: string;
  loggedDate: string;
  weight: number;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function WeightLogWidget({
  athleteId,
  groupId,
  initialLogs,
}: {
  athleteId: string;
  groupId: string;
  initialLogs: WeightLogEntry[];
}) {
  const [logs, setLogs] = useState(initialLogs);
  const [weight, setWeight] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Collapsed to a single line by default — a full-height form every day
  // for every athlete crowds the Day-card for something most people only
  // touch occasionally (see [[athlete_home_calendar_redesign]]). Expands
  // on tap; a coach who wants a real cadence just assigns a "Log body
  // weight" habit instead, no new code needed for that.
  const [expanded, setExpanded] = useState(false);
  // Transformation Cards — a real, newly-crossed weight-loss milestone.
  // Detection is fully automated (right here, the instant a new weight
  // is logged); actually generating/sharing a card stays the athlete's
  // own choice via the "Create a card" link below, never auto-published.
  const [newMilestone, setNewMilestone] = useState<{ id: string; thresholdLbs: number } | null>(null);

  const todayLog = logs.find((l) => l.loggedDate === todayIso());

  async function checkTransformationMilestone(currentWeight: number) {
    const supabase = createBrowserClient();
    const { data: firstEntry } = await supabase
      .from("body_weight_logs")
      .select("weight")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .order("logged_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstEntry) return;

    const totalLossLbs = firstEntry.weight - currentWeight;
    if (totalLossLbs <= 0) return;

    const { data: seenRows } = await supabase
      .from("transformation_milestones")
      .select("threshold_lbs")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId);
    const seen = new Set((seenRows ?? []).map((r) => r.threshold_lbs));
    const newly = computeNewlyCrossedThresholds(totalLossLbs, seen);
    if (newly.length === 0) return;

    // A logging gap (or a real sudden jump) can cross several tiers at
    // once — mark all of them seen so none silently re-fires later, but
    // only ever prompt about the highest one reached this check-in.
    const highest = Math.max(...newly);
    const { data: inserted } = await supabase
      .from("transformation_milestones")
      .insert(
        newly.map((t) => ({
          athlete_id: athleteId,
          group_id: groupId,
          threshold_lbs: t,
          starting_weight: firstEntry.weight,
          current_weight: currentWeight,
        }))
      )
      .select("id, threshold_lbs");

    const highestRow = (inserted ?? []).find((r) => r.threshold_lbs === highest);
    if (highestRow) {
      setNewMilestone({ id: highestRow.id, thresholdLbs: highest });
    }
  }

  const milestoneBanner = newMilestone && (
    <div className="border border-rust/40 bg-rust/5 p-3 mb-3">
      <p className="font-body text-sm text-chalk">
        🎉 You&apos;ve hit a real milestone — down {newMilestone.thresholdLbs}+ lbs since you started!
      </p>
      <div className="flex items-center gap-3 mt-2">
        <Link
          href={`/groups/${groupId}/transformation/new?milestone=${newMilestone.id}`}
          className="font-body text-xs text-rust font-medium"
        >
          Create a card →
        </Link>
        <button
          type="button"
          onClick={() => setNewMilestone(null)}
          className="font-body text-xs text-steel"
        >
          Not now
        </button>
      </div>
    </div>
  );

  if (!expanded) {
    return (
      <div>
        {milestoneBanner}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border border-steel/20 p-4 flex items-center justify-between text-left"
        >
          <span className="font-body text-sm text-chalk">
            {todayLog ? `Today's weight: ${todayLog.weight} lbs` : "Log today's weight"}
          </span>
          <span className="font-body text-xs text-rust">{todayLog ? "Update" : "Log"}</span>
        </button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(weight);
    if (!value || value <= 0) return;

    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const date = todayIso();

    const { data, error: upsertError } = await supabase
      .from("body_weight_logs")
      .upsert(
        { athlete_id: athleteId, group_id: groupId, logged_date: date, weight: value },
        { onConflict: "athlete_id,logged_date" }
      )
      .select("id, logged_date, weight")
      .single();

    if (upsertError || !data) {
      setError(upsertError?.message ?? "Couldn't save weight.");
      setSubmitting(false);
      return;
    }

    setLogs((prev) => [
      { id: data.id, loggedDate: data.logged_date, weight: data.weight },
      ...prev.filter((l) => l.loggedDate !== date),
    ]);
    setWeight("");
    setSubmitting(false);
    setExpanded(false);
    await checkTransformationMilestone(data.weight);
  }

  return (
    <div className="border border-steel/20 p-4">
      {milestoneBanner}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">Body weight</h2>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="font-body text-xs text-steel"
        >
          Close
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder={todayLog ? `Today: ${todayLog.weight} lbs` : "Weight (lbs)"}
          className="flex-1 h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button
          type="submit"
          disabled={submitting || !weight}
          className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {todayLog ? "Update" : "Log"}
        </button>
      </form>

      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}

      {logs.length > 0 && (
        <div className="mt-3 flex gap-3 overflow-x-auto">
          {logs.slice(0, 7).map((l) => (
            <div key={l.id} className="shrink-0 text-center">
              <p className="font-body text-sm">{l.weight}</p>
              <p className="font-body text-[10px] text-steel">
                {new Date(l.loggedDate + "T00:00:00").toLocaleDateString(undefined, {
                  month: "numeric",
                  day: "numeric",
                })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
