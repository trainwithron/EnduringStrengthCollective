"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { DEFAULT_PREFERENCES, preferencesToRow } from "@/lib/nutrition-preferences";

// A client who has never been asked about allergies has no saved food-preferences row, and "never asked" looks exactly like "no allergies" (Oct 19 audit: all 19 clients had no row, and a plan could contain peanuts or
// shellfish with no warning). Until the coach either confirms the client has none or enters them, no plan is built. Confirming saves an ordinary preferences row with no allergies (the same one Save writes), so it
// is on record who answered and when, and the client can still add allergies themselves.
export function AllergiesConfirmBanner({ athleteId, clientName }: { athleteId: string; clientName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmNone() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase.from("client_nutrition_preferences").upsert(preferencesToRow({ ...DEFAULT_PREFERENCES }, athleteId), { onConflict: "athlete_id" });
    setBusy(false);
    if (saveError) {
      setError("Couldn't save. Check your connection and try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mb-4 border border-rust/50 p-3 space-y-2" role="note" data-allergies-banner>
      <p className="font-body text-sm text-chalk">
        {clientName} hasn&apos;t been asked about food allergies. Meal plans can&apos;t be built until you confirm they have none, or enter them below.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={confirmNone} disabled={busy} className="h-10 px-4 border border-rust text-rust font-body text-sm disabled:opacity-40">
          {busy ? "Saving…" : `${clientName} has no allergies`}
        </button>
        <a href="#preferences" className="font-body text-xs text-steel underline underline-offset-2">
          Enter their allergies
        </a>
      </div>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
