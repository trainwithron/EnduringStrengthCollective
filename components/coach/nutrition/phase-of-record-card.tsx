"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { addDaysToKey } from "@/lib/date-key";
import { shortDateLabel } from "@/lib/apply-from";
import { PHASES, PHASE_LABELS, suggestedReviewDate, validatePhasePlan, weeksInPhase, type PhasePlan } from "@/lib/phase-plan";
import { savePhasePlan } from "@/lib/phase-plan-write";
import type { NutritionPhase } from "@/lib/nutrition-checkin";

const selectClass = "h-10 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust";

// The phase a client is in: the coach's own record, with an optional review date and an optional planned next phase. The planned next phase is the coach's private plan:
// the client never sees it. A review date only RAISES a prompt for the coach; nothing ever changes by itself because a date passed.
export function PhaseOfRecordCard({
  athleteId,
  groupId,
  coachId,
  clientName,
  plan,
  derived,
  todayKey,
}: {
  athleteId: string;
  groupId: string;
  coachId: string;
  clientName: string;
  plan: PhasePlan | null;
  // With no saved plan: the phase worked out from the latest check-in or milestone tag, shown as a starting point to save.
  derived: { phase: NutritionPhase; source: "checkin" | "tag" } | null;
  todayKey: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [phase, setPhase] = useState<NutritionPhase>(plan?.phase ?? derived?.phase ?? "maintenance");
  const [reviewOn, setReviewOn] = useState(plan?.reviewOn ?? "");
  const [next, setNext] = useState<NutritionPhase | "">(plan?.plannedNextPhase ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const problem = validatePhasePlan({ phase, reviewOn: reviewOn || null, plannedNextPhase: next || null, todayKey });
    if (problem) return setError(problem);
    setBusy(true);
    const supabase = createBrowserClient();
    const result = await savePhasePlan(supabase, { athleteId, groupId, coachId, phase, reviewOn: reviewOn || null, plannedNextPhase: next || null, todayKey, existing: plan });
    setBusy(false);
    if (!result.ok) return setError("Couldn't save. Check your connection and try again.");
    setEditing(false);
    router.refresh();
  }

  const current = plan?.phase ?? derived?.phase ?? null;
  return (
    <div className="border border-steel/20 p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display font-bold text-sm uppercase tracking-wide text-steel">Phase</h3>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="font-body text-xs text-rust">
            {current ? "Change" : "Set a phase"}
          </button>
        )}
      </div>

      {!editing && (
        <div className="space-y-1 font-body text-sm">
          {current ? (
            <p className="text-chalk">
              {PHASE_LABELS[current]}
              {plan ? ` · week ${weeksInPhase(plan.startedOn, todayKey)} · since ${shortDateLabel(plan.startedOn)}` : ""}
            </p>
          ) : (
            <p className="text-steel">No phase set for {clientName}. Set one so the weekly check-in knows what to aim for.</p>
          )}
          {!plan && derived && (
            <p className="text-xs text-steel">
              Taken from {derived.source === "checkin" ? "their latest check-in" : "their milestone tag"}, not saved as their plan yet. Save it to make it official.
            </p>
          )}
          {plan?.reviewOn && (
            <p className="text-xs text-steel">
              Review {plan.reviewOn <= todayKey ? "was due" : "on"} {shortDateLabel(plan.reviewOn)}.
            </p>
          )}
          {plan?.plannedNextPhase && (
            <p className="text-xs text-steel">
              Planned next: {PHASE_LABELS[plan.plannedNextPhase]}. Only you see this; {clientName} is told nothing until you propose it.
            </p>
          )}
        </div>
      )}

      {editing && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <label className="font-body text-xs text-steel">
              Phase
              <select value={phase} onChange={(e) => setPhase(e.target.value as NutritionPhase)} className={`${selectClass} block mt-1`}>
                {PHASES.map((p) => (
                  <option key={p} value={p}>
                    {PHASE_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="font-body text-xs text-steel">
              Planned next phase (private)
              <select value={next} onChange={(e) => setNext(e.target.value as NutritionPhase | "")} className={`${selectClass} block mt-1`}>
                <option value="">None</option>
                {PHASES.map((p) => (
                  <option key={p} value={p}>
                    {PHASE_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label className="font-body text-xs text-steel block">
              Review date (optional)
              <input type="date" value={reviewOn} min={todayKey} onChange={(e) => setReviewOn(e.target.value)} className={`${selectClass} block mt-1`} />
            </label>
            <div className="flex flex-wrap gap-3 mt-1 font-body text-xs text-rust">
              <button type="button" onClick={() => setReviewOn(addDaysToKey(todayKey, 7))}>In 1 week</button>
              <button type="button" onClick={() => setReviewOn(suggestedReviewDate(todayKey))}>In 2 weeks</button>
              <button type="button" onClick={() => setReviewOn("")} className="text-steel">No review</button>
            </div>
          </div>
          {phase !== (plan?.phase ?? phase) && (
            <p className="font-body text-xs text-steel">Changing the phase starts a new one from today and updates the milestone tag.</p>
          )}
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={save} disabled={busy} className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className="font-body text-sm text-steel">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
