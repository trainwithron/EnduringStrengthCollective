"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MacroCalculator } from "@/components/tools/macro-calculator";
import { WeightLogWidget, type WeightLogEntry } from "@/components/athlete/weight-log-widget";
import { createBrowserClient } from "@/lib/supabase/client";
import { saveStandingTarget } from "@/lib/standing-macros";
import { fillCarbsAndFat, type ActivityLevel, type MacroGoal } from "@/lib/macros";
import { maintenanceSentence, type MaintenanceResult } from "@/lib/real-maintenance";
import type { WeightUnit } from "@/lib/units";

export interface OwnTarget {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

// A suggested maintenance only replaces the target when it differs by at least this much (smaller is noise).
export const MIN_CHANGE_TO_OFFER = 100;

// The real maintenance as a full target: protein kept, carbs and fat in the current ratio (or balanced with none yet).
export function targetFromMaintenance(maintenance: number, current: OwnTarget | null, fallbackProteinG: number): OwnTarget {
  const proteinG = current?.proteinG ?? fallbackProteinG;
  const remaining = Math.max(0, maintenance - proteinG * 4);
  if (current?.carbsG != null && current?.fatG != null && current.carbsG * 4 + current.fatG * 9 > 0) {
    const carbShare = (current.carbsG * 4) / (current.carbsG * 4 + current.fatG * 9);
    return { calories: maintenance, proteinG, carbsG: Math.round((remaining * carbShare) / 4), fatG: Math.round((remaining * (1 - carbShare)) / 9) };
  }
  const split = fillCarbsAndFat(maintenance, proteinG, "balanced");
  return { calories: maintenance, proteinG, carbsG: split?.carbsG ?? null, fatG: split?.fatG ?? null };
}

export function offerMaintenance(maintenance: number, current: OwnTarget | null): boolean {
  return current?.calories == null || Math.abs(maintenance - current.calories) >= MIN_CHANGE_TO_OFFER;
}

// On a client's Nutrition page when their coach has not set a target (Ron, Oct 20: "if your coach hasn't assigned, maybe a macro calculator and then a way to actually find your
// real macros. By trial and error"). Step 1: work out a starting target and save it as their own. Step 2: find their REAL maintenance from their own weigh-ins and food log
// (lib/real-maintenance.ts), offered as a suggestion they choose to use. The coach's target, when one comes, replaces all of this.
export function SetMyTargetsCard({
  athleteId,
  groupId,
  todayKey,
  current,
  weightLb,
  weightUnit,
  activity,
  goal,
  baselineMaintenance,
  hideFatLoss,
  showFindMaintenance,
  maintenance,
  weightLogs,
  canSave,
}: {
  athleteId: string;
  groupId: string;
  todayKey: string;
  // Their own target in force today (null before they set one).
  current: OwnTarget | null;
  weightLb: number | null;
  weightUnit: WeightUnit;
  activity: ActivityLevel | null;
  goal: MacroGoal | null;
  // Mifflin-St Jeor / Katch-McArdle from About you, when height, date of birth and activity are on file.
  baselineMaintenance: number | null;
  hideFatLoss: boolean;
  showFindMaintenance: boolean;
  maintenance: MaintenanceResult;
  weightLogs: WeightLogEntry[];
  // The database lets them save (minor_may_write: an adult with a date of birth on their health form, or a teen with a signed guardian). Without it the calculator still shows, with no save.
  canSave: boolean;
}) {
  const router = useRouter();
  const [calculatorOpen, setCalculatorOpen] = useState(current == null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  async function save(target: OwnTarget) {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const result = await saveStandingTarget(supabase, { athleteId, groupId, userId: user?.id ?? null, target, today: todayKey, setBy: "self" });
    setBusy(false);
    if (!result.ok) {
      setError("That didn't save. Nothing was changed. If you are under 18, a parent or guardian needs to give permission first; otherwise try again.");
      return;
    }
    setCalculatorOpen(false);
    router.refresh();
  }

  const ready = maintenance.ready ? maintenance : null;
  const fallbackProtein = Math.round(weightLb ?? 150);

  return (
    <div className="space-y-5" data-set-my-targets>
      <div>
        <p className="font-body text-sm font-semibold text-chalk">Set my targets</p>
        <p className="font-body text-xs text-steel mt-1">
          {current ? "This is your own target. When your coach sets one, theirs takes over." : "Your coach hasn't set a nutrition target yet. Work one out here and save it as yours until they do."}
        </p>
        {current && !calculatorOpen && (
          <button type="button" onClick={() => setCalculatorOpen(true)} className="mt-2 min-h-11 font-body text-sm text-rust underline underline-offset-2">
            Change my target
          </button>
        )}
        {calculatorOpen && (
          <div className="mt-3">
            <MacroCalculator
              initialWeight={weightLb}
              weightUnit={weightUnit}
              initialActivity={activity}
              initialGoal={goal}
              maintenanceOverride={baselineMaintenance}
              maintenanceNote={baselineMaintenance != null ? "From your height, age, sex and activity in About you." : null}
              hideFatLoss={hideFatLoss}
              useLabel={busy ? "Saving…" : "Save as my target"}
              onUseMacros={canSave ? (m) => void save({ calories: m.calories, proteinG: m.protein, carbsG: m.carbs, fatG: m.fats }) : undefined}
            />
            {!canSave && (
              <p className="font-body text-xs text-steel mt-3" data-cannot-save>
                To save a target of your own, your date of birth needs to be on your health form (and, under 18, a parent or guardian needs to give permission). Ask your coach to send you the form.
              </p>
            )}
          </div>
        )}
      </div>

      {canSave && showFindMaintenance && !dismissed && (
        <div className="border-t border-steel/15 pt-4" data-find-maintenance>
          <p className="font-body text-sm font-semibold text-chalk">Find my real maintenance</p>
          {ready ? (
            <div className="mt-1 space-y-2">
              <p className="font-body text-sm text-chalk">{maintenanceSentence(ready)}</p>
              <p className="font-body text-sm text-chalk">
                Your real maintenance is about {ready.maintenance.toLocaleString("en-US")}. <span className="text-steel">This only works if you logged everything you ate.</span>
              </p>
              {offerMaintenance(ready.maintenance, current) && (
                <div className="flex flex-wrap gap-3 pt-1">
                  <button type="button" disabled={busy} onClick={() => void save(targetFromMaintenance(ready.maintenance, current, fallbackProtein))} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
                    Use {ready.maintenance.toLocaleString("en-US")} as my target
                  </button>
                  <button type="button" onClick={() => setDismissed(true)} className="min-h-11 px-4 border border-steel/30 text-steel font-body text-sm">
                    Not now
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-1 space-y-2">
              <p className="font-body text-xs text-steel">Weigh in each morning, at least 3 times a week, and log everything you eat. About 2 weeks.</p>
              {!maintenance.ready && maintenance.missing.length > 0 && <p className="font-body text-xs text-chalk">Still needed: {maintenance.missing.join(", ")}.</p>}
              <WeightLogWidget athleteId={athleteId} groupId={groupId} initialLogs={weightLogs} weightUnit={weightUnit} />
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
