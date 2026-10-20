"use client";

import { useState } from "react";
import { FreeTextFoodLog, type FoodLogEntry } from "./meal-checkoff-list";
import { createBrowserClient } from "@/lib/supabase/client";
import { insertFoodLogEntry } from "@/lib/food-log-insert";
import { defaultMealSlot } from "@/lib/food-entry";
import { QUICK_ADD_DEFAULT_NAME, quickAddEntry } from "@/lib/quick-add-numbers";

// Standalone entry point for anything not tied to a planned meal — a
// snack, eating out, or just skipping the checkoff list entirely and
// describing the whole day free-form. Same AI-estimate-then-confirm
// flow as "Modified" on a planned meal (calorie_tracking_ux_research_
// and_plan.md, V1) — deliberately not a separate "Ate Out" system with
// its own presets; one text box covers both, since the AI estimate path
// already handles "I don't know exactly what was in it" reasonably.
// "Just the numbers" (Ron, Oct 20): the calories and macros typed straight in, for a label or a number someone already knows.
// Favorites and Recent are on Today's food itself (FIX_NUTRITION_PHONE item 3), so they are not repeated here.
export function QuickLogFoodButton({
  athleteId,
  groupId,
  logDate,
  onLogged,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  onLogged: (entry: FoodLogEntry) => void;
}) {
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <div className="border border-steel/20 p-3">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">
          Log something else
        </p>
        <FreeTextFoodLog
          athleteId={athleteId}
          groupId={groupId}
          logDate={logDate}
          mealSlot={defaultMealSlot(new Date().getHours(), new Date().getMinutes())}
          status="quick_log"
          placeholder="What did you eat? e.g. &quot;chipotle bowl, chicken, white rice, black beans&quot;"
          onLogged={(entry) => {
            onLogged(entry);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
        <JustTheNumbers
          athleteId={athleteId}
          groupId={groupId}
          logDate={logDate}
          onLogged={(entry) => {
            onLogged(entry);
            setOpen(false);
          }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="w-full min-h-[44px] border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors"
    >
      + Log something else (snack, ate out, etc.)
    </button>
  );
}

// Calories, protein, carbs, fat and an optional name: one plain logged food, into the meal for the time of day.
function JustTheNumbers({
  athleteId,
  groupId,
  logDate,
  onLogged,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  onLogged: (entry: FoodLogEntry) => void;
}) {
  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    const checked = quickAddEntry({ name, calories, protein, carbs, fat });
    if ("problem" in checked) {
      setProblem(checked.problem);
      return;
    }
    setSaving(true);
    setProblem(null);
    const entry = await insertFoodLogEntry(createBrowserClient(), {
      athleteId,
      groupId,
      logDate,
      mealSlot: defaultMealSlot(new Date().getHours(), new Date().getMinutes()),
      status: "quick_log",
      ...checked.entry,
    });
    setSaving(false);
    if (!entry) {
      setProblem("That didn't save. Check your connection and try again.");
      return;
    }
    onLogged(entry);
  }

  const field = "w-full min-h-[44px] bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust";
  const numberField = (label: string, value: string, set: (v: string) => void) => (
    <label className="block">
      <span className="font-body text-xs text-steel">{label}</span>
      <input type="text" inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} aria-label={label} className={field} />
    </label>
  );

  return (
    <div className="mt-3 pt-3 border-t border-steel/15" data-testid="just-the-numbers">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">Just the numbers</p>
      <div className="grid grid-cols-2 gap-2">
        {numberField("Calories", calories, setCalories)}
        {numberField("Protein (g)", protein, setProtein)}
        {numberField("Carbs (g)", carbs, setCarbs)}
        {numberField("Fat (g)", fat, setFat)}
      </div>
      <label className="block mt-2">
        <span className="font-body text-xs text-steel">Name (optional)</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={QUICK_ADD_DEFAULT_NAME} aria-label="Name (optional)" className={field} />
      </label>
      {problem && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {problem}
        </p>
      )}
      <button type="button" onClick={save} disabled={saving} className="mt-2 min-h-[44px] px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
