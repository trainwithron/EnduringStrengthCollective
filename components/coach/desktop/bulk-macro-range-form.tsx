"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { macroAutofill, withAutofill } from "@/lib/macro-autofill";
import { autoFieldProps, MacroMismatchLine, WorkedOutTag } from "@/components/coach/nutrition/macro-autofill-bits";
import { createBrowserClient } from "@/lib/supabase/client";
import { PROTEIN_G_PER_LB, estimateProteinFromBodyWeight, fillCarbsAndFat } from "@/lib/macros";
import { enumerateDateKeys } from "@/lib/date-range";

const MAX_RANGE_DAYS = 90;

// "Hotel booking" style bulk assignment — pick a check-in/check-out
// style date range and one set of macro targets, apply to every day in
// that range in one upsert instead of opening each day individually.
// Deliberately always overwrites the whole range (no "skip days that
// already have a target" option) — same as picking new dates for an
// existing hotel reservation replaces every night, not just the empty
// ones; a coach who wants to preserve some days already knows to pick a
// narrower range.
export function BulkMacroRangeForm({
  athleteId,
  groupId,
  latestBodyWeight,
}: {
  athleteId: string;
  groupId: string;
  latestBodyWeight: number | null;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [calories, setCalories] = useState("");
  const [bodyWeight, setBodyWeight] = useState(latestBodyWeight?.toString() ?? "");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const router = useRouter();

  // The one blank of the four, worked out from the other three (lib/macro-autofill.ts); what is shown is what is saved.
  const fill = macroAutofill({ calories, protein, carbs, fat });
  const filled = withAutofill({ calories, protein, carbs, fat }, fill);
  const auto = { calories: autoFieldProps("calories", calories, fill), protein: autoFieldProps("protein", protein, fill), carbs: autoFieldProps("carbs", carbs, fill), fat: autoFieldProps("fat", fat, fill) };

  const dateKeys = startDate && endDate ? enumerateDateKeys(startDate, endDate, MAX_RANGE_DAYS) : [];
  const canApply = dateKeys.length > 0 && filled.calories.trim() !== "" && !applying;

  function handleBodyWeightChange(value: string) {
    setBodyWeight(value);
    const w = Number(value);
    if (w > 0) setProtein(estimateProteinFromBodyWeight(w).toString());
  }

  function fillSplit(kind: "high" | "low") {
    const result = fillCarbsAndFat(Number(calories), Number(protein), kind);
    if (!result) return;
    setCarbs(result.carbsG.toString());
    setFat(result.fatG.toString());
  }

  async function handleApply() {
    if (!canApply) return;
    if (
      !await confirmDialog({
        message: `Apply these macro targets to all ${dateKeys.length} day${
          dateKeys.length === 1 ? "" : "s"
        } from ${startDate} to ${endDate}? This replaces any existing targets already saved on those days.`,
        confirmLabel: "Apply targets",
      })
    ) {
      return;
    }
    setApplying(true);
    setError(null);
    setAppliedCount(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setApplying(false);
      setError("Couldn't apply — try again.");
      return;
    }

    const rows = dateKeys.map((logDate) => ({
      athlete_id: athleteId,
      group_id: groupId,
      log_date: logDate,
      calories: filled.calories ? Number(filled.calories) : null,
      protein_g: filled.protein ? Number(filled.protein) : null,
      carbs_g: filled.carbs ? Number(filled.carbs) : null,
      fat_g: filled.fat ? Number(filled.fat) : null,
      created_by: user.id,
    }));

    const { error: upsertError } = await supabase
      .from("daily_macros")
      .upsert(rows, { onConflict: "athlete_id,log_date" });

    setApplying(false);
    if (upsertError) {
      setError("Couldn't apply the range — try again.");
      return;
    }
    setAppliedCount(dateKeys.length);
    router.refresh();
  }

  return (
    <div className="border border-steel/20 p-4">
      <h3 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
        Set targets for a date range
      </h3>
      <p className="font-body text-xs text-steel mb-3">
        These become day-specific targets that win over the standing target for those dates.
      </p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">From</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">To</span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
      </div>

      {startDate && endDate && (
        <p className="font-body text-xs text-steel mb-3">
          {dateKeys.length > 0
            ? `${dateKeys.length} day${dateKeys.length === 1 ? "" : "s"} selected${
                dateKeys.length === MAX_RANGE_DAYS ? ` (capped at ${MAX_RANGE_DAYS})` : ""
              }`
            : "End date must be on or after the start date."}
        </p>
      )}

      <div className="space-y-2">
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Calories
            <WorkedOutTag show={auto.calories.auto} />
          </span>
          <input
            type="number"
            min="0"
            value={auto.calories.value}
            onFocus={auto.calories.onFocus}
            onChange={(e) => setCalories(e.target.value)}
            className={`h-9 bg-graphite border border-steel/30 px-2 font-body text-sm focus:outline-none focus:border-rust ${auto.calories.auto ? "text-steel italic" : "text-chalk"}`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Body weight (lbs) — sets protein at {PROTEIN_G_PER_LB}g/lb
          </span>
          <input
            type="number"
            min="0"
            value={bodyWeight}
            onChange={(e) => handleBodyWeightChange(e.target.value)}
            className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-body text-xs text-steel uppercase tracking-wide">
              Protein (g)
              <WorkedOutTag show={auto.protein.auto} />
            </span>
            <input
              type="number"
              min="0"
              value={auto.protein.value}
              onFocus={auto.protein.onFocus}
              onChange={(e) => setProtein(e.target.value)}
              className={`h-9 bg-graphite border border-steel/30 px-2 font-body text-sm focus:outline-none focus:border-rust ${auto.protein.auto ? "text-steel italic" : "text-chalk"}`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-body text-xs text-steel uppercase tracking-wide">
              Carbs (g)
              <WorkedOutTag show={auto.carbs.auto} />
            </span>
            <input
              type="number"
              min="0"
              value={auto.carbs.value}
              onFocus={auto.carbs.onFocus}
              onChange={(e) => setCarbs(e.target.value)}
              className={`h-9 bg-graphite border border-steel/30 px-2 font-body text-sm focus:outline-none focus:border-rust ${auto.carbs.auto ? "text-steel italic" : "text-chalk"}`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-body text-xs text-steel uppercase tracking-wide">
              Fat (g)
              <WorkedOutTag show={auto.fat.auto} />
            </span>
            <input
              type="number"
              min="0"
              value={auto.fat.value}
              onFocus={auto.fat.onFocus}
              onChange={(e) => setFat(e.target.value)}
              className={`h-9 bg-graphite border border-steel/30 px-2 font-body text-sm focus:outline-none focus:border-rust ${auto.fat.auto ? "text-steel italic" : "text-chalk"}`}
            />
          </label>
        </div>
        <MacroMismatchLine fill={fill} />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fillSplit("high")}
            disabled={!calories || !protein}
            className="flex-1 h-8 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
          >
            High carb fill
          </button>
          <button
            type="button"
            onClick={() => fillSplit("low")}
            disabled={!calories || !protein}
            className="flex-1 h-8 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
          >
            Low carb fill
          </button>
        </div>
      </div>

      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
      {appliedCount != null && (
        <p className="font-body text-xs text-positive mt-2">
          Applied to {appliedCount} day{appliedCount === 1 ? "" : "s"}.
        </p>
      )}

      <button
        type="button"
        onClick={handleApply}
        disabled={!canApply}
        className="w-full h-9 mt-3 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
      >
        {applying ? "Applying…" : "Apply to range"}
      </button>
    </div>
  );
}
