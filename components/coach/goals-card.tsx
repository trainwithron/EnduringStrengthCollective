"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GOAL_TYPE_LABELS, GOAL_TYPE_ORDER } from "@/lib/goal-types";
import type { GoalType } from "@/lib/goal-reversal";
import { EMPTY_GOAL_SHEET, goalSheetHasAnswers, type GoalSheetRow } from "@/lib/goal-sheet";
import { goalSheetSummary, goalsCardPill, goalsCardState, mainGoalLine } from "@/lib/goals-all-in-one";
import { visibleSubGoals, type SubGoalView } from "@/lib/sub-goals";
import { SubGoalsSection } from "@/components/shared/sub-goals-section";
import { GoalSheetAnswersList, sheetAnswers } from "@/components/shared/goal-sheet-fields";
import { GoalsForm, type FormGoal } from "@/components/shared/goals-form";

// The one Goals card on the coach's view of a client (Ron, Nov 23: goals, all in one): the main goal, the smaller goals and the goal sheet, one status, one send.
//   Not started:  Send to <name>  ·  Fill in with <name>
//   Sent:         Remind <name>   ·  Fill in with <name>
//   Filled in:    Edit            ·  Send again (redo)
// Before sending, the coach may suggest a main goal (the client sees it already filled in and can change it). `goalControl` is the existing confirm / decline of a goal the
// client proposed, or the take-back of one the coach suggested, shown inside the card.
export function GoalsCard({
  groupId,
  athleteId,
  viewerId,
  clientFirstName,
  timeZone,
  sheet,
  goal,
  subGoals,
  goalControl,
}: {
  groupId: string;
  athleteId: string;
  viewerId: string;
  clientFirstName: string;
  timeZone?: string;
  sheet: GoalSheetRow | null;
  goal: (FormGoal & { createdBy: string | null }) | null;
  subGoals: SubGoalView[];
  goalControl?: ReactNode;
}) {
  const router = useRouter();
  const first = clientFirstName || "your client";
  const state = goalsCardState(sheet);
  const answers = sheet ? sheetAnswers(sheet) : EMPTY_GOAL_SHEET;
  const main = goal ? mainGoalLine({ goal_type: goal.goalType, custom_label: goal.customLabel, target_date: goal.targetDate, status: goal.status, created_by: goal.createdBy }, athleteId, first) : null;
  const subs = visibleSubGoals(subGoals);
  // A main goal can be suggested with the send unless one is already being agreed.
  const canSuggest = goal?.status !== "proposed";

  const [mode, setMode] = useState<"view" | "send" | "fill">("view");
  const [suggestType, setSuggestType] = useState<GoalType | "">("");
  const [suggestLabel, setSuggestLabel] = useState("");
  const [suggestDate, setSuggestDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(remind: boolean) {
    if (busy) return;
    if (!remind && suggestType === "custom" && !suggestLabel.trim()) {
      setError("Describe the goal you suggest, or pick one from the list.");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    const suggestion = !remind && suggestType ? { goalType: suggestType, customLabel: suggestLabel, targetDate: suggestDate || null } : null;
    let ok = false;
    try {
      const res = await fetch("/api/goal-sheet/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, athleteId, suggestion, remind }) });
      ok = res.ok;
    } catch {
      ok = false;
    }
    setBusy(false);
    if (!ok) {
      setError("Couldn't send it. Try again.");
      return;
    }
    setMode("view");
    setSuggestType("");
    setSuggestLabel("");
    setSuggestDate("");
    setNote(remind ? `Reminded. ${first} got another notice.` : `Sent. ${first} got a notice to fill in their goals.`);
    router.refresh();
  }

  const pillTone = state === "done" ? "text-moss" : state === "sent" ? "text-rust-ink" : "text-steel";
  const btn = "inline-flex items-center justify-center min-h-12 px-4 font-body text-sm border";
  const primary = `${btn} border-rust text-rust-ink active:bg-rust/10`;
  const plain = `${btn} border-steel/40 text-chalk active:bg-steel/10`;
  const k = "font-body text-xs text-steel uppercase tracking-wide";
  const field = "w-full min-h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-base";

  return (
    <section aria-label="Goals" className="border border-steel/20 p-4 mb-6" data-goals-card={state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display uppercase text-base tracking-wide text-chalk">Goals</h2>
        <span className={`font-body text-xs px-2.5 py-0.5 border border-current whitespace-nowrap ${pillTone}`} data-goals-pill>
          {goalsCardPill(state, sheet, first, timeZone)}
        </span>
      </div>

      {mode === "fill" ? (
        <div className="mt-4">
          <GoalsForm
            groupId={groupId}
            athleteId={athleteId}
            viewer="coach"
            viewerId={viewerId}
            otherFirstName={first}
            goal={goal}
            subGoals={subGoals}
            sheet={answers}
            onDone={() => setMode("view")}
          />
        </div>
      ) : (
        <>
          <dl className="grid gap-3 mt-4">
            <div className="grid grid-cols-1 min-[480px]:grid-cols-[8rem_1fr] gap-x-3 gap-y-0.5">
              <dt className={k}>Main goal</dt>
              <dd className={`font-body text-sm ${main ? "text-chalk" : "text-steel"}`} data-goals-main>
                {main ? (
                  <>
                    {main.text}
                    {main.note && <span className="text-steel"> ({main.note})</span>}
                  </>
                ) : (
                  "None yet"
                )}
              </dd>
            </div>
            <div className="grid grid-cols-1 min-[480px]:grid-cols-[8rem_1fr] gap-x-3 gap-y-0.5">
              <dt className={k}>Smaller goals</dt>
              <dd className="font-body text-sm" data-goals-subs>
                {subs.length > 0 ? (
                  <SubGoalsSection groupId={groupId} athleteId={athleteId} viewerId={viewerId} otherName={first} items={subGoals} bare />
                ) : (
                  <span className="text-steel">{state === "sent" ? `${first} adds these` : "None yet"}</span>
                )}
              </dd>
            </div>
            <div className="grid grid-cols-1 min-[480px]:grid-cols-[8rem_1fr] gap-x-3 gap-y-0.5">
              <dt className={k}>Goal sheet</dt>
              <dd className={`font-body text-sm ${state === "done" ? "text-chalk" : "text-steel"}`} data-goals-sheet>
                {goalSheetHasAnswers(answers) ? goalSheetSummary(answers) : state === "sent" ? `${first} fills this in` : "Not filled in"}
              </dd>
            </div>
          </dl>

          {goalControl && <div className="mt-4">{goalControl}</div>}

          {goalSheetHasAnswers(answers) && (
            <details className="mt-4 border-t border-steel/20 pt-3">
              <summary className="min-h-11 flex items-center cursor-pointer font-body text-sm text-rust-ink">Read {first}&apos;s answers</summary>
              <div className="mt-2">
                <GoalSheetAnswersList sheet={answers} />
              </div>
            </details>
          )}

          {mode === "send" ? (
            <div className="mt-4 border-t border-steel/20 pt-4 space-y-2" data-goals-send>
              {canSuggest && (
                <>
                  <label className={`block ${k}`}>
                    Suggest a main goal (optional)
                    <select aria-label="Suggest a main goal" value={suggestType} onChange={(e) => setSuggestType(e.target.value as GoalType | "")} className={`${field} mt-1`}>
                      <option value="">No suggestion: {first} chooses</option>
                      {GOAL_TYPE_ORDER.map((t) => (
                        <option key={t} value={t}>
                          {GOAL_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {suggestType === "custom" && <input aria-label="Describe the goal" value={suggestLabel} maxLength={200} onChange={(e) => setSuggestLabel(e.target.value)} placeholder="Describe the goal" className={field} />}
                  {suggestType && (
                    <label className={`block ${k}`}>
                      By when? (optional)
                      <input aria-label="By when?" type="date" value={suggestDate} onChange={(e) => setSuggestDate(e.target.value)} className={`${field} mt-1`} />
                    </label>
                  )}
                  <p className="font-body text-xs text-steel">{first} sees it already filled in and can change it.</p>
                </>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={() => send(false)} disabled={busy} className={`${primary} disabled:opacity-40`}>
                  {busy ? "Sending…" : `Send to ${first}`}
                </button>
                <button type="button" onClick={() => setMode("view")} className={plain}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 mt-4" data-goals-actions>
              {state === "new" && (
                <>
                  <button type="button" onClick={() => setMode("send")} className={primary}>
                    Send to {first}
                  </button>
                  <button type="button" onClick={() => setMode("fill")} className={plain}>
                    Fill in with {first}
                  </button>
                </>
              )}
              {state === "sent" && (
                <>
                  <button type="button" onClick={() => send(true)} disabled={busy} className={`${primary} disabled:opacity-40`}>
                    {busy ? "Sending…" : `Remind ${first}`}
                  </button>
                  <button type="button" onClick={() => setMode("fill")} className={plain}>
                    Fill in with {first}
                  </button>
                </>
              )}
              {state === "done" && (
                <>
                  <button type="button" onClick={() => setMode("fill")} className={primary}>
                    Edit
                  </button>
                  <button type="button" onClick={() => setMode("send")} className={plain}>
                    Send again (redo)
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

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
    </section>
  );
}
