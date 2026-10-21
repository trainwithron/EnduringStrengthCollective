"use client";

import { useState } from "react";
import { PreferencesSection } from "@/components/coach/nutrition/preferences-section";
import type { NutritionPreferences } from "@/lib/nutrition-preferences";

const clean = (a: string) => (a.toLowerCase().startsWith("other: ") ? a.slice(7) : a);
const list = (items: string[]) => (items.length > 0 ? items.map(clean).join(", ") : "None");

// The client's own answers about food, read-only with a small Edit (Ron, Oct 21: allergy data appeared three times on the page). Never answered (no saved row) reads "Waiting on <name>'s answer":
// no plan is built until it is answered, by the client or by the coach under Edit (saving with nothing ticked records "none").
export function ClientAnswersSection({
  athleteId,
  prefs,
  answered,
  weightLbs,
  updatedByName,
  updatedAtLabel,
  clientName,
  checkinRestrictions,
}: {
  athleteId: string;
  prefs: NutritionPreferences;
  /** A saved row exists (the client or a coach answered). */
  answered: boolean;
  weightLbs: number | null;
  updatedByName: string | null;
  updatedAtLabel: string | null;
  clientName: string;
  checkinRestrictions?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const rows: { label: string; value: string }[] = [
    { label: "Allergies", value: list(prefs.allergies) },
    { label: "Intolerances", value: list(prefs.intolerances) },
    { label: "Foods they avoid", value: list(prefs.dislikes) },
    { label: "Foods they like", value: list(prefs.likes) },
  ];

  return (
    <div className="space-y-3" data-client-answers>
      {answered ? (
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 max-w-[760px]">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="font-body text-xs text-steel">{r.label}</dt>
              <dd className={`font-body text-sm ${r.label === "Allergies" && prefs.allergies.length > 0 ? "text-rust" : "text-chalk"}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="font-body text-sm text-amber" role="status" data-waiting-answer>
          Waiting on {clientName}&apos;s answer about food allergies. No meal plan is built until it is answered.
        </p>
      )}
      <p className="font-body text-xs text-steel">
        {answered && updatedByName && updatedAtLabel ? `Answered by ${updatedByName} on ${updatedAtLabel}. ` : ""}
        <button type="button" onClick={() => setEditing((v) => !v)} aria-expanded={editing} className="text-rust underline underline-offset-2 min-h-[44px] px-1 -my-3">
          {editing ? "Close" : answered ? "Edit" : "Answer for them"}
        </button>
      </p>
      {editing && (
        <div className="border border-steel/20 p-4">
          <PreferencesSection
            athleteId={athleteId}
            initial={prefs}
            weightLbs={weightLbs}
            updatedByName={updatedByName}
            updatedAtLabel={updatedAtLabel}
            clientName={clientName}
            checkinRestrictions={checkinRestrictions}
            neverSaved={!answered}
          />
        </div>
      )}
    </div>
  );
}
