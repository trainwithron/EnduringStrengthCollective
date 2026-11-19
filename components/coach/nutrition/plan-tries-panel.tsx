"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { shortDateLabel } from "@/lib/apply-from";
import { MAX_PLAN_TRIES } from "@/lib/meal-plan-retry";
import type { MealRecipeChoice } from "@/lib/meal-plan-assignment";
import { caloriesProteinLine, starFromChoice } from "@/lib/starred-meals";
import { StarMealButton } from "@/components/coach/nutrition/star-meal-button";

export interface PlanTryView {
  id: string;
  tryNumber: number;
  note: string;
  summary: string;
  dates: string[];
  requestedAt: string;
  restored: boolean;
  // 'allergy': the app swapped the options that broke a new allergy or food they avoid (0430). Not a try, and never put back.
  source: "client" | "allergy";
  // The meals of the plan from before this change (each option once), so a meal the client had can be starred.
  previousMeals?: MealRecipeChoice[];
}

// When a client asked for a different meal plan ("Not feeling it?"): what they said, which try it was, which days were rebuilt, and one tap to put back the plan from before. The put-back
// goes one try at a time (the latest first) and leaves any day you changed by hand since.
// The meals from before a change, folded away; each with its calories and protein and a star.
function MealsBefore({ meals }: { meals?: MealRecipeChoice[] }) {
  if (!meals || meals.length === 0) return null;
  return (
    <details className="mt-1 border border-steel/15" data-meals-before>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden min-h-11 flex items-center px-2 font-body text-xs text-rust">
        Meals before this change ({meals.length})
      </summary>
      <ul className="border-t border-steel/15 divide-y divide-steel/10">
        {meals.map((m, i) => {
          const star = starFromChoice(m);
          if (!star) return null;
          return (
            <li key={`${star.key}|${i}`} className="flex items-center gap-1 pl-2">
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm text-chalk break-words">{star.name}</p>
                <p className="font-body text-xs text-steel [font-variant-numeric:tabular-nums]">{caloriesProteinLine(star)}</p>
              </div>
              <StarMealButton star={star} />
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function PlanTriesPanel({ clientName, tries }: { clientName: string; tries: PlanTryView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (tries.length === 0) return null;

  // The latest change that has not been put back: the only one that can be put back now (an allergy rebuild never can, and a try older than one cannot either).
  const latest = tries.find((t) => !t.restored) ?? null;
  const latestId = latest && latest.source === "client" ? latest.id : null;
  const asked = tries.some((t) => t.source === "client");

  async function putBack(id: string) {
    setError(null);
    setMessage(null);
    setBusy(true);
    const supabase = createBrowserClient();
    const { data, error: rpcError } = await supabase.rpc("restore_meal_plan_try", { p_try_id: id });
    setBusy(false);
    if (rpcError) {
      setError(/not_latest/.test(rpcError.message) ? "Put back the later try first." : /already_restored/.test(rpcError.message) ? "That try was already put back." : "Couldn't put the plan back. Check your connection and try again.");
      router.refresh();
      return;
    }
    const n = typeof data === "number" ? data : 0;
    setMessage(n === 0 ? "Nothing needed to change: every day was already changed by hand." : `Put back ${n} ${n === 1 ? "day" : "days"} from before that try.`);
    router.refresh();
  }

  return (
    <div className="mb-4 border border-steel/20 p-3 space-y-2" aria-label="Plan change requests">
      <p className="font-body text-sm text-chalk font-medium">{asked ? `${clientName} asked for a different meal plan` : `${clientName}'s meal plan changed automatically`}</p>
      <ul className="space-y-2">
        {tries.map((t) =>
          t.source === "allergy" ? (
            <li key={t.id} className="font-body text-sm text-chalk" data-allergy-rebuild>
              <span className="text-steel">Rebuilt automatically on {shortDateLabel(t.requestedAt.slice(0, 10))}:</span> {t.summary}
              <MealsBefore meals={t.previousMeals} />
            </li>
          ) : (
          <li key={t.id} className="font-body text-sm text-chalk">
            <span className="text-steel">
              Try {t.tryNumber} of {MAX_PLAN_TRIES}, {shortDateLabel(t.requestedAt.slice(0, 10))}
              {t.dates.length > 0 ? `, ${t.dates.length} ${t.dates.length === 1 ? "day" : "days"} rebuilt` : ""}
              {t.restored ? ", put back" : ""}:
            </span>{" "}
            {t.note ? `“${t.note}”` : "(no note)"}
            {t.summary ? <span className="block text-xs text-steel">Understood as: {t.summary}</span> : null}
            {/never offered/.test(t.summary) ? <span className="block text-xs text-steel">If this is a real allergy, add it in Preferences.</span> : null}
            {t.id === latestId && (
              <button type="button" disabled={busy} onClick={() => putBack(t.id)} className="mt-1 min-h-11 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
                {busy ? "Putting back…" : "Put back the plan from before"}
              </button>
            )}
            <MealsBefore meals={t.previousMeals} />
          </li>
          )
        )}
      </ul>
      {message && (
        <p className="font-body text-xs text-chalk" role="status">
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
