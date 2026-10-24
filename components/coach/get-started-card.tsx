"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { useTerm } from "@/components/coach/terminology-provider";
import { hiddenForClient, hideForClient, HIDE_GET_STARTED_KEY, type GetStartedStep } from "@/lib/get-started-checklist";

// The coach's short list for a new client (lib/get-started-checklist.ts decides whether it shows at all). × hides it for this client; "Don't show for new clients" hides it everywhere.
export function GetStartedCard({ athleteId, firstName, steps }: { athleteId: string; firstName: string; steps: GetStartedStep[] }) {
  // Not drawn until this browser's per-client choice is read, so a card the coach hid never flashes up.
  const [hidden, setHidden] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setHidden(hiddenForClient(safeStorage(), athleteId));
  }, [athleteId]);

  async function hideForAll() {
    setError(null);
    const { error: saveError } = await createBrowserClient().auth.updateUser({ data: { [HIDE_GET_STARTED_KEY]: true } });
    if (saveError) {
      setError("Couldn't save that. Try again.");
      return;
    }
    setHidden(true);
  }

  if (hidden) return null;
  return (
    <GetStartedList
      firstName={firstName}
      steps={steps}
      error={error}
      onHideClient={() => {
        hideForClient(safeStorage(), athleteId);
        setHidden(true);
      }}
      onHideAll={hideForAll}
    />
  );
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function GetStartedList({
  firstName,
  steps,
  error = null,
  onHideClient,
  onHideAll,
}: {
  firstName: string;
  steps: GetStartedStep[];
  error?: string | null;
  onHideClient?: () => void;
  onHideAll?: () => void;
}) {
  const t = useTerm();
  return (
    <section className="border border-steel/30 p-4 mb-6" aria-label={`Get ${firstName} started`} data-get-started>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display font-bold text-sm uppercase tracking-wide">Get {firstName} started</h2>
        <button type="button" onClick={onHideClient} aria-label={`Hide for ${firstName}`} className="-mt-2 -mr-2 w-11 h-11 flex items-center justify-center text-steel hover:text-chalk">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <ol className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.key}>
            {s.done ? (
              <span className="flex items-center gap-2 min-h-11 font-body text-sm text-steel" data-step-done={s.key}>
                <Check className="w-4 h-4 text-positive shrink-0" strokeWidth={2.5} aria-hidden="true" />
                <span className="line-through decoration-steel/50">{s.label}</span>
                <span className="sr-only">(done)</span>
              </span>
            ) : (
              <Link href={s.href} className="flex items-center gap-2 min-h-11 font-body text-sm text-chalk hover:text-rust" data-step-open={s.key}>
                <span className="w-4 text-center font-display text-xs text-rust shrink-0">{i + 1}</span>
                {s.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
      <button type="button" onClick={onHideAll} className="mt-1 min-h-11 font-body text-xs text-steel hover:text-chalk">
        Don&apos;t show for new {t("client", "plural")}
      </button>
      {error && <p className="font-body text-xs text-rust">{error}</p>}
    </section>
  );
}
