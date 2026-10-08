"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { PHASE_LABELS } from "@/lib/phase-plan";
import type { BaselineOutcome } from "@/lib/nutrition-baseline";
import { createBaselineSuggestion } from "@/lib/baseline-suggestion";

// "Suggest a starting target": worked out from the client's own numbers (About you) by the calculator, shown here before anything is made. Creating it adds an ordinary
// pending suggestion the coach reviews and applies like any other; nothing applies by itself.
export function BaselinePrompt({
  athleteId,
  groupId,
  clientName,
  outcome,
  phaseNote,
  archetype,
  hasStanding,
  hasPendingBaseline,
}: {
  athleteId: string;
  groupId: string;
  clientName: string;
  outcome: BaselineOutcome;
  // Where the phase came from: "their confirmed goal", "their phase", "not set, so maintenance".
  phaseNote: string;
  archetype: "standard" | "keto" | "carnivore";
  hasStanding: boolean;
  hasPendingBaseline: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!hasStanding);
  if (hasPendingBaseline) return null;

  async function create() {
    if (!outcome.ok) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const made = await createBaselineSuggestion(supabase, { athleteId, groupId, outcome, archetype });
    setBusy(false);
    if (!made.ok) return setError("Couldn't make the suggestion. Try again.");
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="font-body text-xs text-rust">
        Suggest a starting target from {clientName}&apos;s numbers
      </button>
    );
  }

  return (
    <div className="border border-steel/20 p-4 space-y-2">
      <h3 className="font-display font-bold text-sm uppercase tracking-wide text-steel">Starting target</h3>
      {outcome.ok ? (
        <>
          <p className="font-body text-sm text-chalk [font-variant-numeric:tabular-nums]">
            {outcome.calories.toLocaleString("en-US")} calories · P {outcome.proteinG} · C {outcome.carbsG} · F {outcome.fatG}
            <span className="text-steel"> · {PHASE_LABELS[outcome.phase]} ({phaseNote})</span>
          </p>
          <p className="font-body text-xs text-steel max-w-[70ch]">{outcome.rationale}</p>
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
          <button type="button" onClick={create} disabled={busy} className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
            {busy ? "Making it…" : "Make this a suggestion to review"}
          </button>
        </>
      ) : (
        <p className="font-body text-sm text-steel">
          Needs {outcome.missing.join(", ")} before a starting target can be worked out. {clientName} can fill them in on their About you screen (Settings), or you can enter the height, sex and
          activity level above.{outcome.missing.includes("date of birth") ? " Only the client can add a date of birth." : ""}
        </p>
      )}
    </div>
  );
}
