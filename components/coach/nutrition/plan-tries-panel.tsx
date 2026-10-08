"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { shortDateLabel } from "@/lib/apply-from";
import { MAX_PLAN_TRIES } from "@/lib/meal-plan-retry";

export interface PlanTryView {
  id: string;
  tryNumber: number;
  note: string;
  summary: string;
  dates: string[];
  requestedAt: string;
  restored: boolean;
}

// When a client asked for a different meal plan ("Not feeling it?"): what they said, which try it was, which days were rebuilt, and one tap to put back the plan from before. The put-back
// goes one try at a time (the latest first) and leaves any day you changed by hand since.
export function PlanTriesPanel({ clientName, tries }: { clientName: string; tries: PlanTryView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (tries.length === 0) return null;

  // The latest try that has not been put back: the only one that can be put back now.
  const latestId = tries.find((t) => !t.restored)?.id ?? null;

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
      <p className="font-body text-sm text-chalk font-medium">{clientName} asked for a different meal plan</p>
      <ul className="space-y-2">
        {tries.map((t) => (
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
          </li>
        ))}
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
