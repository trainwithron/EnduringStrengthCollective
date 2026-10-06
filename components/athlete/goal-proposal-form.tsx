"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { GOAL_TYPE_LABELS, GOAL_TYPE_ORDER, goalTypeHasEventFields } from "@/lib/goal-types";
import type { GoalType } from "@/lib/goal-reversal";
import { notifyPush } from "@/lib/push-notify";

// The client always sets/owns the goal — the coach is kept in the loop
// (sees it, confirms it), never the author. Same preset+Custom pattern
// already used for the dashboard word-swap presets.
// A coach can use the same form to SUGGEST a goal to a client (`suggestedBy` = the coach's id): the client then confirms it, changes it or declines it.
export function GoalProposalForm({ athleteId, groupId, suggestedBy }: { athleteId: string; groupId: string; suggestedBy?: string }) {
  const [goalType, setGoalType] = useState<GoalType>("weight_loss");
  const [customLabel, setCustomLabel] = useState("");
  const [priorityNote, setPriorityNote] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [eventType, setEventType] = useState("");
  const [eventPriority, setEventPriority] = useState<"" | "A" | "B" | "C">("");
  const [weightClassFlag, setWeightClassFlag] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: insertError } = await supabase.from("client_goals").insert({
      athlete_id: athleteId,
      group_id: groupId,
      goal_type: goalType,
      custom_label: goalType === "custom" ? customLabel.trim() || null : null,
      priority_note: priorityNote.trim() || null,
      target_date: targetDate || null,
      event_type: goalTypeHasEventFields(goalType) ? eventType.trim() || null : null,
      event_priority: goalTypeHasEventFields(goalType) && eventPriority ? eventPriority : null,
      weight_class_flag: goalType === "powerbuilding_strongman" ? weightClassFlag : false,
      created_by: suggestedBy ?? athleteId,
    });
    setSubmitting(false);
    if (insertError) {
      setError(suggestedBy ? "Couldn't send that suggestion. Try again." : "Couldn't save your goal — try again.");
      return;
    }
    if (suggestedBy) {
      notifyPush(athleteId, "Your coach suggested a goal", "Open My Goal to confirm it, change it, or say not now.", `/groups/${groupId}/goal`);
    }
    setSubmitted(true);
    router.refresh();
  }

  if (submitted) {
    return (
      <p className="font-body text-sm text-moss">
        {suggestedBy
          ? "Suggested. They'll see it on My Goal and can confirm it, change it, or say not now."
          : "Sent to your coach for confirmation — they'll take it from here."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
      <div>
        <label className="font-body text-xs text-steel uppercase tracking-wide">Goal</label>
        <select
          value={goalType}
          onChange={(e) => setGoalType(e.target.value as GoalType)}
          className="w-full h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
        >
          {GOAL_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {GOAL_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {goalType === "custom" && (
        <input
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
          placeholder="Describe your goal"
          className="w-full h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm"
        />
      )}

      {goalTypeHasEventFields(goalType) && (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            placeholder="Sport / event"
            className="h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm"
          />
          <select
            value={eventPriority}
            onChange={(e) => setEventPriority(e.target.value as "" | "A" | "B" | "C")}
            className="h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm"
          >
            <option value="">Priority</option>
            <option value="A">A — top priority</option>
            <option value="B">B — secondary</option>
            <option value="C">C — tune-up</option>
          </select>
        </div>
      )}

      {goalType === "powerbuilding_strongman" && (
        <label className="flex items-center gap-2 font-body text-xs text-steel">
          <input
            type="checkbox"
            checked={weightClassFlag}
            onChange={(e) => setWeightClassFlag(e.target.checked)}
            className="accent-rust"
          />
          I&apos;m also cutting weight to make a weight class for this
        </label>
      )}

      <div>
        <label className="font-body text-xs text-steel uppercase tracking-wide">
          Target date (optional)
        </label>
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="w-full h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
        />
      </div>

      <div>
        <label className="font-body text-xs text-steel uppercase tracking-wide">
          {suggestedBy ? "Anything specific to add? (optional)" : "Anything specific your coach should know? (optional)"}
        </label>
        <textarea
          value={priorityNote}
          onChange={(e) => setPriorityNote(e.target.value)}
          rows={2}
          placeholder="e.g. rear delts, an event I'm prepping for"
          className="w-full bg-surface border border-steel/30 text-chalk px-2 py-1.5 font-body text-sm mt-1"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full h-10 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
      >
        {suggestedBy ? "Suggest to client" : "Send to my coach"}
      </button>
    </form>
  );
}
