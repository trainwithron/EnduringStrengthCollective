"use client";

import { useState } from "react";
import { FreeTextFoodLog, type FoodLogEntry } from "./meal-checkoff-list";

// Standalone entry point for anything not tied to a planned meal — a
// snack, eating out, or just skipping the checkoff list entirely and
// describing the whole day free-form. Same AI-estimate-then-confirm
// flow as "Modified" on a planned meal (calorie_tracking_ux_research_
// and_plan.md, V1) — deliberately not a separate "Ate Out" system with
// its own presets; one text box covers both, since the AI estimate path
// already handles "I don't know exactly what was in it" reasonably.
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
          mealSlot={null}
          status="quick_log"
          placeholder="What did you eat? e.g. &quot;chipotle bowl, chicken, white rice, black beans&quot;"
          onLogged={(entry) => {
            onLogged(entry);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="w-full h-10 border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors"
    >
      + Log something else (snack, ate out, etc.)
    </button>
  );
}
