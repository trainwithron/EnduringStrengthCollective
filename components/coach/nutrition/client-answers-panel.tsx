"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { moreVariety, type RecalcAnswer } from "@/lib/recalc-prompt";
import { scaleSavedPlans, describeScalePlans } from "@/lib/scale-plans";
import { shortDateLabel } from "@/lib/apply-from";
import { VARIETY_LABELS, type VarietyValue } from "@/lib/nutrition-preferences";
import type { MacroTargetsLike } from "@/lib/plan-scaling";

// What a client answered to "are you happy with your meal plan?" after a new target. The coach can mark an answer handled, turn the variety up when the client called the plan
// boring, scale the saved plan to the new number in one tap (nothing is rebuilt and no AI is used), or go build the plan again with the client's words in front of them.
export function ClientAnswersPanel({
  athleteId,
  clientName,
  answers,
  variety,
  currentTarget,
  todayKey,
  metric,
}: {
  athleteId: string;
  clientName: string;
  answers: RecalcAnswer[];
  variety: string;
  // The target in force today, whole numbers; null when there is none to scale to.
  currentTarget: MacroTargetsLike | null;
  todayKey: string;
  metric: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentVariety, setCurrentVariety] = useState(variety);
  const open = answers.filter((a) => a.status === "new");
  const handled = answers.filter((a) => a.status === "handled");
  const wantsVariety = open.some((a) => a.boring);
  const topOfVariety = moreVariety(currentVariety) === currentVariety;
  const varietyLabel = (v: string) => VARIETY_LABELS[v as VarietyValue] ?? v;

  if (answers.length === 0) return null;

  async function markHandled(id: string) {
    setError(null);
    setMessage(null);
    setBusy(id);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // The database fills in who and when; only the status is sent.
    const { error: updateError } = await supabase.from("client_nutrition_feedback").update({ status: "handled", handled_by: user?.id ?? null }).eq("id", id);
    setBusy(null);
    if (updateError) {
      setError("Couldn't mark that handled. Check your connection and try again.");
      return;
    }
    router.refresh();
  }

  async function turnUpVariety() {
    setError(null);
    setMessage(null);
    setBusy("variety");
    const next = moreVariety(currentVariety);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase.from("client_nutrition_preferences").upsert({ athlete_id: athleteId, variety: next }, { onConflict: "athlete_id" });
    setBusy(null);
    if (saveError) {
      setError("Couldn't change the variety. Check your connection and try again.");
      return;
    }
    setCurrentVariety(next);
    setMessage(`Meal variety is now "${varietyLabel(next)}". New plans use it.`);
    router.refresh();
  }

  async function scalePlan() {
    if (!currentTarget) return;
    if (!await confirmDialog(`Scale ${clientName}'s saved meal plans from today on to ${currentTarget.calories.toLocaleString("en-US")} calories? Amounts change; the meals stay the same.`)) return;
    setError(null);
    setMessage(null);
    setBusy("scale");
    const supabase = createBrowserClient();
    const outcome = await scaleSavedPlans(supabase, { athleteId, fromKey: todayKey, target: currentTarget, metric });
    setBusy(null);
    if (!outcome.ok) {
      setError(outcome.error);
      if (outcome.written > 0) router.refresh();
      return;
    }
    setMessage(describeScalePlans(outcome.result));
    router.refresh();
  }

  return (
    <div className="border border-rust/40 p-4 space-y-4" role="region" aria-label={`${clientName}'s answers about their meal plan`}>
      <div>
        <h3 className="font-display uppercase text-sm tracking-wide">Client answers</h3>
        <p className="font-body text-xs text-steel mt-1 max-w-[70ch]">
          After a new target, {clientName} was asked whether they are happy with their meal plan.{open.length === 0 ? " Everything they sent has been handled." : ""}
        </p>
      </div>

      {open.map((a) => (
        <div key={a.id} className="border-t border-steel/15 pt-3 space-y-1.5">
          <p className="font-body text-sm text-chalk">
            <span className={a.happy ? "text-positive" : "text-rust"}>{a.happy ? "Happy with it" : "Would change something"}</span>
            <span className="text-steel"> · target from {shortDateLabel(a.targetEffectiveFrom)}</span>
          </p>
          {a.changeText && <p className="font-body text-sm text-chalk">&ldquo;{a.changeText}&rdquo;</p>}
          {a.requestsText && <p className="font-body text-sm text-chalk">&ldquo;{a.requestsText}&rdquo;</p>}
          {a.boring && <p className="font-body text-xs text-amber-400">Says the plan is getting boring.</p>}
          <button type="button" onClick={() => markHandled(a.id)} disabled={busy !== null} className="h-10 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
            {busy === a.id ? "Saving…" : "Mark handled"}
          </button>
        </div>
      ))}

      {open.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-steel/15 pt-3">
          <button
            type="button"
            onClick={scalePlan}
            disabled={busy !== null || !currentTarget}
            title={currentTarget ? undefined : "There is no target in force today to scale to."}
            className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            {busy === "scale" ? "Scaling…" : "Scale my plan to the new target"}
          </button>
          <a href="#meal-plan" className="h-11 px-5 border border-rust text-rust font-body text-sm flex items-center">
            Rebuild with their requests
          </a>
          {wantsVariety && (
            <button type="button" onClick={turnUpVariety} disabled={busy !== null || topOfVariety} className="h-11 px-5 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
              {topOfVariety ? `Variety is already "${varietyLabel(currentVariety)}"` : `More variety (now "${varietyLabel(currentVariety)}")`}
            </button>
          )}
        </div>
      )}

      {handled.length > 0 && (
        <p className="font-body text-xs text-steel">
          {handled.length} earlier {handled.length === 1 ? "answer" : "answers"} handled.
        </p>
      )}
      {message && (
        <p className="font-body text-sm text-positive max-w-[70ch]" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
