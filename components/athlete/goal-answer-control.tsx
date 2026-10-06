"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { GOAL_TYPE_LABELS, GOAL_TYPE_ORDER } from "@/lib/goal-types";
import type { GoalType } from "@/lib/goal-reversal";
import { notifyPush } from "@/lib/push-notify";

export interface SuggestedGoal {
  id: string;
  goalType: string;
  customLabel: string | null;
  targetDate: string | null;
  priorityNote: string | null;
}

// A goal the coach suggested. The client confirms it as it is, changes it (it then goes back to the coach to agree to), or says not now.
// Nothing about the goal affects targets or programs until both sides have agreed.
export function GoalAnswerControl({ goal, groupId, coachIds }: { goal: SuggestedGoal; groupId: string; coachIds: string[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "change">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [goalType, setGoalType] = useState<GoalType>(goal.goalType as GoalType);
  const [customLabel, setCustomLabel] = useState(goal.customLabel ?? "");
  const [targetDate, setTargetDate] = useState(goal.targetDate ?? "");
  const [note, setNote] = useState(goal.priorityNote ?? "");

  const label = goal.goalType === "custom" && goal.customLabel ? goal.customLabel : GOAL_TYPE_LABELS[goal.goalType as GoalType] ?? goal.goalType;

  function tellCoach(body: string) {
    for (const id of coachIds) notifyPush(id, "About a goal", body, `/groups/${groupId}/athletes`);
  }

  async function answer(status: "confirmed" | "declined") {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase.from("client_goals").update({ status }).eq("id", goal.id);
    setBusy(false);
    if (updateError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setDone(status === "confirmed" ? "Goal confirmed. Your coach has been told." : "Okay. Your coach has been told it isn't right for now.");
    tellCoach(status === "confirmed" ? "Your client confirmed the goal you suggested." : "Your client said not now to the goal you suggested.");
    router.refresh();
  }

  async function saveChange() {
    if (goalType === "custom" && !customLabel.trim()) {
      setError("Describe your goal.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("client_goals")
      .update({
        goal_type: goalType,
        custom_label: goalType === "custom" ? customLabel.trim() : null,
        target_date: targetDate || null,
        priority_note: note.trim() || null,
      })
      .eq("id", goal.id);
    setBusy(false);
    if (updateError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setDone("Sent back to your coach with your changes. They'll take it from here.");
    tellCoach("Your client suggested a change to the goal.");
    router.refresh();
  }

  if (done) return <p className="font-body text-sm text-moss">{done}</p>;

  return (
    <div className="border border-rust/40 bg-rust/5 p-4 mb-6">
      <p className="font-body text-xs text-rust uppercase tracking-wide font-bold mb-1">Your coach suggested a goal</p>
      {mode === "view" ? (
        <>
          <p className="font-body text-lg">{label}</p>
          {goal.targetDate && <p className="font-body text-sm text-steel mt-1">Target date: {goal.targetDate}</p>}
          {goal.priorityNote && <p className="font-body text-sm text-steel mt-1">{goal.priorityNote}</p>}
          <p className="font-body text-xs text-steel mt-2">It won&apos;t change your plan until you both agree.</p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button type="button" disabled={busy} onClick={() => answer("confirmed")} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              Looks right
            </button>
            <button type="button" disabled={busy} onClick={() => setMode("change")} className="h-11 px-4 border border-steel/30 text-chalk font-body text-sm">
              Change it
            </button>
            <button type="button" disabled={busy} onClick={() => answer("declined")} className="h-11 px-3 font-body text-sm text-steel underline underline-offset-2">
              Not now
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="font-body text-xs text-steel uppercase tracking-wide">Goal</label>
            <select value={goalType} onChange={(e) => setGoalType(e.target.value as GoalType)} className="w-full h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm mt-1">
              {GOAL_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {GOAL_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          {goalType === "custom" && (
            <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Describe your goal" className="w-full h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm" />
          )}
          <div>
            <label className="font-body text-xs text-steel uppercase tracking-wide">Target date (optional)</label>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="w-full h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm mt-1" />
          </div>
          <div>
            <label className="font-body text-xs text-steel uppercase tracking-wide">Anything to add? (optional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full bg-surface border border-steel/30 text-chalk px-2 py-1.5 font-body text-sm mt-1" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={saveChange} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              Send back to my coach
            </button>
            <button type="button" disabled={busy} onClick={() => setMode("view")} className="h-11 px-3 font-body text-sm text-steel">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
