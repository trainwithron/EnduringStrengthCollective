"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { localDateKey } from "@/lib/timezone";
import { computeNewlyCrossedThresholds } from "@/lib/transformation-milestones";
import { displayWeightValue, formatWeight, parseWeightInput, weightUnitLabel, type WeightUnit } from "@/lib/units";
import { HomeSheet } from "@/components/athlete/home-sheet";

// The Log weight tile on Home (Ron, Nov 21) opens a small pop-up: one number box, already focused so the phone keyboard comes up, in the client's unit, with Save and Cancel.
// It is the same save as the form below (saveWeight), and after it the pop-up says "Saved: 182.4 lb" and closes.
export const OPEN_WEIGHT_EVENT = "open-weight-log";
export const SAVED_CLOSE_MS = 1400;
export const savedWeightLine = (lbs: number, unit: WeightUnit) => `Saved: ${formatWeight(lbs, unit)}`;

export interface WeightLogEntry {
  id: string;
  loggedDate: string;
  weight: number;
}

function todayIso() {
  return localDateKey();
}

export function WeightLogWidget({
  athleteId,
  groupId,
  initialLogs,
  weightUnit = "lb",
  opensFromTile = false,
  initialSheetOpen = false,
}: {
  athleteId: string;
  groupId: string;
  initialLogs: WeightLogEntry[];
  // How the client likes to see weight. Weights are always stored in pounds; this only changes what is shown and typed.
  weightUnit?: WeightUnit;
  // On Home: the Log weight tile opens this widget's pop-up (only the one on Home listens, so a weight log on another page never opens too).
  opensFromTile?: boolean;
  // (tests: draw the pop-up open)
  initialSheetOpen?: boolean;
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
  // The tile's pop-up: whether it is open, what is typed in it, and "Saved: 182.4 lb" once saved.
  const [sheetOpen, setSheetOpen] = useState(initialSheetOpen);
  const [sheetWeight, setSheetWeight] = useState("");
  const [sheetSaved, setSheetSaved] = useState<string | null>(null);
  // Its own problem line: one left in the pop-up never turns up in the form below, nor the other way round.
  const [sheetError, setSheetError] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!opensFromTile) return;
    // flushSync: the box is on the screen and focused while the tap is still being handled, which is when a phone lets the keyboard come up.
    const open = () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      flushSync(() => {
        setSheetWeight("");
        setSheetSaved(null);
        setSheetError(null);
        setSheetOpen(true);
      });
    };
    window.addEventListener(OPEN_WEIGHT_EVENT, open);
    return () => window.removeEventListener(OPEN_WEIGHT_EVENT, open);
  }, [opensFromTile]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  const todayLog = logs.find((l) => l.loggedDate === todayIso());

  async function checkTransformationMilestone(currentWeight: number): Promise<boolean> {
    const supabase = createBrowserClient();
    const { data: firstEntry } = await supabase
      .from("body_weight_logs")
      .select("weight")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .order("logged_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstEntry) return false;

    const totalLossLbs = firstEntry.weight - currentWeight;
    if (totalLossLbs <= 0) return false;

    const { data: seenRows } = await supabase
      .from("transformation_milestones")
      .select("threshold_lbs")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId);
    const seen = new Set((seenRows ?? []).map((r) => r.threshold_lbs));
    const newly = computeNewlyCrossedThresholds(totalLossLbs, seen);
    if (newly.length === 0) return false;

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
      return true;
    }
    return false;
  }

  // The one weight save, for the form below and the tile's pop-up: what was typed, in the client's unit, read once as pounds (what is stored). A converted number is never saved twice.
  // Returns the pounds saved, or the problem in words for whichever of the two asked (each shows its own).
  async function saveWeight(typed: string): Promise<{ weight: number } | { problem: string }> {
    const value = parseWeightInput(typed, weightUnit);
    if (value == null) return { problem: "That doesn't look like a body weight. Check the number." };

    setSubmitting(true);
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
      setSubmitting(false);
      return { problem: upsertError?.message ?? "Couldn't save weight." };
    }

    setLogs((prev) => [
      { id: data.id, loggedDate: data.logged_date, weight: data.weight },
      ...prev.filter((l) => l.loggedDate !== date),
    ]);
    setSubmitting(false);
    return { weight: data.weight };
  }

  async function handleSheetSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSheetError(null);
    const result = await saveWeight(sheetWeight);
    if ("problem" in result) {
      setSheetError(result.problem);
      return;
    }
    const saved = result.weight;
    setSheetSaved(savedWeightLine(saved, weightUnit));
    // A milestone just reached stays on the screen until they choose; otherwise the pop-up closes on its own.
    const milestone = await checkTransformationMilestone(saved);
    if (!milestone) closeTimer.current = setTimeout(() => setSheetOpen(false), SAVED_CLOSE_MS);
  }

  const milestoneBanner = newMilestone && (
    <div className="tint-win rounded-row p-3 mb-3">
      <p className="font-body text-sm text-chalk">
        🎉 You&apos;ve hit a real milestone — down {displayWeightValue(newMilestone.thresholdLbs, weightUnit)}+ {weightUnit === "kg" ? "kg" : "lbs"} since you started!
      </p>
      <div className="flex items-center gap-3 mt-2">
        <Link
          href={`/groups/${groupId}/transformation/new?milestone=${newMilestone.id}`}
          className="inline-flex items-center min-h-11 font-body text-xs text-rust-ink font-medium"
        >
          Create a card →
        </Link>
        <button
          type="button"
          onClick={() => setNewMilestone(null)}
          className="inline-flex items-center min-h-11 font-body text-xs text-steel"
        >
          Not now
        </button>
      </div>
    </div>
  );

  const unitLabel = weightUnitLabel(weightUnit);
  const sheet = opensFromTile && (
    <HomeSheet open={sheetOpen} title="Log weight" onClose={() => setSheetOpen(false)} guard={() => (submitting ? "block" : "close")} returnFocusTo='[data-tile="weight"]'>
      {sheetSaved ? (
        <div data-weight-saved>
          <p className="font-body text-base font-semibold text-win py-2" role="status">
            {sheetSaved}
          </p>
          {milestoneBanner}
          <button type="button" onClick={() => setSheetOpen(false)} className="mt-2 w-full h-11 rounded-token-pill border border-steel/40 font-body text-sm text-chalk">
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={handleSheetSubmit} data-weight-sheet>
          <label htmlFor="weight-sheet-input" className="block font-body text-sm text-steel">
            {todayLog ? `Today's weight in ${unitLabel} (now ${formatWeight(todayLog.weight, weightUnit)})` : `Today's weight in ${unitLabel}`}
          </label>
          <input
            id="weight-sheet-input"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            autoFocus
            value={sheetWeight}
            onChange={(e) => setSheetWeight(e.target.value)}
            className="mt-2 w-full h-14 rounded-row bg-surface-2 border border-steel/30 text-chalk px-4 font-display text-2xl tabular-nums focus:outline-none focus:border-rust"
          />
          {sheetError && (
            <p className="font-body text-xs text-rust-ink mt-2" role="alert">
              {sheetError}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <button type="button" onClick={() => setSheetOpen(false)} disabled={submitting} className="h-11 rounded-token-pill border border-steel/40 font-body text-sm text-chalk disabled:opacity-40">
              Cancel
            </button>
            <button type="submit" disabled={submitting || !sheetWeight.trim()} className="h-11 rounded-token-pill bg-rust text-graphite font-body text-sm font-semibold disabled:opacity-40">
              {submitting ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      )}
    </HomeSheet>
  );
  // While the pop-up is open the milestone shows in it, not twice.
  const pageBanner = sheet && sheetOpen ? null : milestoneBanner;

  if (!expanded) {
    return (
      <div>
        {sheet}
        {pageBanner}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border border-steel/20 p-4 flex items-center justify-between text-left"
        >
          <span className="font-body text-sm text-chalk">
            {todayLog ? `Today's weight: ${formatWeight(todayLog.weight, weightUnit)}` : "Log today's weight"}
          </span>
          <span className="font-body text-xs text-rust-ink">{todayLog ? "Update" : "Log"}</span>
        </button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await saveWeight(weight);
    if ("problem" in result) {
      setError(result.problem);
      return;
    }
    setWeight("");
    setExpanded(false);
    await checkTransformationMilestone(result.weight);
  }

  return (
    <div className="bg-surface rounded-card p-4">
      {sheet}
      {pageBanner}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-body text-[15px] font-semibold text-chalk">Body weight</h2>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-flex items-center min-h-11 font-body text-xs text-steel"
        >
          Close
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input aria-label={`Weight (${weightUnit})`}
          type="number"
          inputMode="decimal"
          step="0.1"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder={todayLog ? `Today: ${formatWeight(todayLog.weight, weightUnit)}` : `Weight (${weightUnit})`}
          className="flex-1 h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button
          type="submit"
          disabled={submitting || !weight}
          className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {todayLog ? "Update" : "Log"}
        </button>
      </form>

      {error && (
        <p className="font-body text-xs text-rust-ink mt-2" role="alert">
          {error}
        </p>
      )}

      {logs.length > 0 && (
        <div className="mt-3 flex gap-3 overflow-x-auto">
          {logs.slice(0, 7).map((l) => (
            <div key={l.id} className="shrink-0 text-center">
              <p className="font-body text-sm">{displayWeightValue(l.weight, weightUnit)}</p>
              <p className="font-body text-xs text-steel">
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
