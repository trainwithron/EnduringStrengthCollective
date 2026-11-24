"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { GOAL_TYPE_LABELS, GOAL_TYPE_ORDER, goalTypeHasEventFields } from "@/lib/goal-types";
import type { GoalType } from "@/lib/goal-reversal";
import type { GoalSheetAnswers } from "@/lib/goal-sheet";
import { subGoalPill, visibleSubGoals, type SubGoalView } from "@/lib/sub-goals";
import { GoalSheetFields } from "./goal-sheet-fields";

export interface FormGoal {
  id?: string;
  goalType: string;
  customLabel: string | null;
  targetDate: string | null;
  eventType: string | null;
  eventPriority: string | null;
  weightClassFlag: boolean;
  status: string;
  createdBy: string | null;
}

// "Your goals" (Ron, Nov 23: "put in their main goals, a sub goal, and then fill out the goal sheet"): the main goal, smaller goals and Ron's 7 questions on one page, saved by
// one button through /api/goals. The client sends it to their coach; a coach filling it in with the client saves it (their main goal is then a suggestion the client confirms).
export function GoalsForm({
  groupId,
  athleteId,
  viewer,
  viewerId,
  otherFirstName,
  goal,
  subGoals,
  sheet,
  onDone,
}: {
  groupId: string;
  athleteId: string;
  viewer: "client" | "coach";
  viewerId: string;
  // the coach's first name on the client's page, the client's on the coach's
  otherFirstName: string;
  goal: FormGoal | null;
  subGoals: SubGoalView[];
  sheet: GoalSheetAnswers;
  onDone?: () => void;
}) {
  const router = useRouter();
  const start = goal && goal.status !== "declined" ? goal : null;
  const goalId = start?.id ?? null;
  const [goalType, setGoalType] = useState<GoalType | "">((start?.goalType as GoalType) ?? "");
  const [customLabel, setCustomLabel] = useState(start?.customLabel ?? "");
  const [targetDate, setTargetDate] = useState(start?.targetDate ?? "");
  const [eventType, setEventType] = useState(start?.eventType ?? "");
  const [eventPriority, setEventPriority] = useState<"" | "A" | "B" | "C">((start?.eventPriority as "A" | "B" | "C") ?? "");
  const [weightClassFlag, setWeightClassFlag] = useState(!!start?.weightClassFlag);
  const [newSubs, setNewSubs] = useState<string[]>([""]);
  const [answers, setAnswers] = useState<GoalSheetAnswers>(sheet);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A goal the coach suggested that is waiting on the client: shown already filled in, theirs to keep or change.
  const coachSuggested = viewer === "client" && !!start && start.status === "proposed" && start.createdBy !== athleteId;
  const shownSubs = visibleSubGoals(subGoals);
  const field = "w-full min-h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-base";
  const heading = "font-display uppercase text-sm tracking-wide text-chalk";

  // "Not now" to the goal the coach suggested, as the goal page has always allowed (the database tells the coach).
  async function notNow() {
    if (busy || !goalId) return;
    setBusy(true);
    setError(null);
    const { error: updateError } = await createBrowserClient().from("client_goals").update({ status: "declined" }).eq("id", goalId);
    setBusy(false);
    if (updateError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setGoalType("");
    setNote(`Okay. ${otherFirstName} has been told it isn't right for now.`);
    router.refresh();
  }

  async function send() {
    if (busy) return;
    if (goalType === "custom" && !customLabel.trim()) {
      setError("Describe your main goal, or pick one from the list.");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    const payload = {
      groupId,
      athleteId,
      goal: goalType ? { goalType, customLabel, targetDate, eventType, eventPriority: eventPriority || null, weightClassFlag } : null,
      subGoals: newSubs,
      answers,
    };
    let ok = false;
    try {
      const res = await fetch("/api/goals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      ok = res.ok;
    } catch {
      ok = false;
    }
    setBusy(false);
    if (!ok) {
      setError(viewer === "client" ? "Couldn't send your goals. Nothing was lost; try again." : "Couldn't save. Try again.");
      return;
    }
    setNewSubs([""]);
    setNote(viewer === "client" ? `Sent to ${otherFirstName}.` : "Saved.");
    router.refresh();
    onDone?.();
  }

  return (
    <div data-goals-form>
      <div className="space-y-2">
        <h3 className={heading}>Main goal</h3>
        <select aria-label="Main goal" value={goalType} onChange={(e) => setGoalType(e.target.value as GoalType | "")} className={field}>
          <option value="">{viewer === "client" ? "Choose your main goal" : "No main goal yet"}</option>
          {GOAL_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {GOAL_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        {coachSuggested && (
          <p className="font-body text-xs text-steel" data-coach-suggested>
            {otherFirstName} suggested this. Change it if it isn&apos;t right.{" "}
            <button type="button" onClick={notNow} disabled={busy} className="min-h-11 text-steel underline underline-offset-2 disabled:opacity-40">
              Not now
            </button>
          </p>
        )}
        {viewer === "client" && start && !coachSuggested && (
          <p className="font-body text-xs text-steel">{start.status === "confirmed" ? `Agreed with ${otherFirstName}.` : `Waiting on ${otherFirstName} to confirm.`}</p>
        )}
        {goalType === "custom" && <input aria-label="Describe your goal" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} maxLength={200} placeholder="Describe your goal" className={field} />}
        {goalType && goalTypeHasEventFields(goalType) && (
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
            <input aria-label="Sport / event" value={eventType} onChange={(e) => setEventType(e.target.value)} maxLength={120} placeholder="Sport / event" className={field} />
            <select aria-label="Event priority" value={eventPriority} onChange={(e) => setEventPriority(e.target.value as "" | "A" | "B" | "C")} className={field}>
              <option value="">Priority</option>
              <option value="A">A — top priority</option>
              <option value="B">B — secondary</option>
              <option value="C">C — tune-up</option>
            </select>
          </div>
        )}
        {goalType === "powerbuilding_strongman" && (
          <label className="flex items-center gap-2 min-h-11 font-body text-sm text-steel">
            <input type="checkbox" checked={weightClassFlag} onChange={(e) => setWeightClassFlag(e.target.checked)} className="accent-rust w-5 h-5" />
            Also cutting weight to make a weight class
          </label>
        )}
        {goalType && (
          <label className="block font-body text-xs text-steel uppercase tracking-wide">
            By when?
            <input aria-label="By when?" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={`${field} mt-1`} />
          </label>
        )}
      </div>

      <div className="space-y-2 border-t border-steel/20 pt-4 mt-4">
        <h3 className={heading}>
          Smaller goals <span className="font-body normal-case tracking-normal text-xs text-steel">optional</span>
        </h3>
        {shownSubs.length > 0 && (
          <ul className="space-y-1" data-existing-sub-goals>
            {shownSubs.map((g) => (
              <li key={g.id} className="font-body text-sm text-chalk">
                {g.title} <span className="text-xs text-steel">· {subGoalPill({ status: g.status, proposedBy: g.proposedBy, viewerId, otherName: otherFirstName })}</span>
              </li>
            ))}
          </ul>
        )}
        {newSubs.map((t, i) => (
          <input
            key={i}
            aria-label={`Smaller goal ${shownSubs.length + i + 1}`}
            value={t}
            maxLength={120}
            placeholder="Deadlift 315"
            onChange={(e) => setNewSubs((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
            className={field}
          />
        ))}
        {newSubs.length < 10 && (
          <button type="button" onClick={() => setNewSubs((s) => [...s, ""])} className="min-h-11 font-body text-sm text-rust-ink">
            + Add another
          </button>
        )}
      </div>

      <div className="border-t border-steel/20 pt-4 mt-4">
        <h3 className={`${heading} mb-3`}>About you</h3>
        <GoalSheetFields answers={answers} onChange={setAnswers} />
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <button type="button" onClick={send} disabled={busy} className="w-full h-12 bg-rust text-graphite font-display uppercase text-sm font-bold disabled:opacity-40">
          {busy ? (viewer === "client" ? "Sending…" : "Saving…") : viewer === "client" ? `Send to ${otherFirstName}` : "Save"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="w-full h-11 border border-steel/40 text-chalk font-body text-sm">
            Cancel
          </button>
        )}
      </div>
      {note && (
        <p className="font-body text-sm text-moss mt-3" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="font-body text-sm text-rust-ink mt-3" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
