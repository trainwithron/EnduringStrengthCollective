"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Check } from "lucide-react";

export interface TodayMacros {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface TodayHabit {
  id: string;
  title: string;
  completed: boolean;
}

export interface PinnedProShopLink {
  id: string;
  title: string;
  url: string;
}

// A whole number with thousands commas, or "--" when it is not known.
export function shownNumber(n: number | null | undefined): string {
  return n == null ? "--" : Math.round(n).toLocaleString("en-US");
}

export function TodayWidget({
  todayDate,
  macros,
  habits,
  pinnedLinks,
  mealLine,
  mealHref,
  eaten = null,
}: {
  // What is logged so far today (the same sum as the Nutrition page's ring): each number shows as eaten / target (CL22, Nov 21).
  eaten?: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  todayDate: string;
  macros: TodayMacros | null;
  habits: TodayHabit[];
  // coach_identity_bio_social_link_pinning_scoping_sept19.md — a Pro
  // Shop link the coach pinned specifically to this athlete's today
  // (e.g. an intra-workout supplement on a heavy-training day).
  // Optional/undefined for any caller that hasn't fetched it.
  pinnedLinks?: PinnedProShopLink[];
  // "Meals logged: 2 of 4" and where to log the rest.
  mealLine?: string | null;
  mealHref?: string;
}) {
  const [state, setState] = useState(habits);
  const [error, setError] = useState<string | null>(null);

  async function toggle(habitId: string, current: boolean) {
    setError(null);
    setState((prev) => prev.map((h) => (h.id === habitId ? { ...h, completed: !current } : h)));
    const supabase = createBrowserClient();
    const { error: upsertError } = await supabase
      .from("habit_logs")
      .upsert(
        { habit_id: habitId, log_date: todayDate, completed_at: !current ? new Date().toISOString() : null },
        { onConflict: "habit_id,log_date" }
      );

    // The checkbox already flipped optimistically — if the write actually
    // failed, flip it back rather than leaving the UI showing a completion
    // that was never saved.
    if (upsertError) {
      setState((prev) => prev.map((h) => (h.id === habitId ? { ...h, completed: current } : h)));
      setError("Couldn't save — check your connection and try again.");
    }
  }

  const hasMacros = macros && (macros.calories != null || macros.proteinG != null);
  if (!hasMacros && state.length === 0 && !mealLine) return null;

  return (
    <div className="bg-surface rounded-card p-4">
      <h2 className="font-body text-[15px] font-semibold text-chalk mb-3">Nutrition and habits</h2>

      {hasMacros && (
        // The whole block opens Nutrition, where the food is logged (CL22).
        <Link href={mealHref ?? "#"} className="block mb-4 -mx-1 px-1 rounded-row active:bg-surface-2" data-today-eaten>
          <p className="font-body text-[13px] font-semibold text-steel mb-1">{eaten ? "Eaten today" : "Your targets today"}</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: "Kcal", target: macros!.calories, eaten: eaten?.calories },
              { label: "Protein", target: macros!.proteinG, eaten: eaten?.proteinG },
              { label: "Carbs", target: macros!.carbsG, eaten: eaten?.carbsG },
              { label: "Fat", target: macros!.fatG, eaten: eaten?.fatG },
            ].map((m) => (
              <div key={m.label} className="min-w-0">
                <p className="font-display text-lg leading-none tabular-nums">{m.eaten == null ? shownNumber(m.target) : shownNumber(m.eaten)}</p>
                {m.eaten != null && <p className="font-body text-[11px] text-steel tabular-nums mt-0.5">of {shownNumber(m.target)}</p>}
                <p className="font-body text-xs text-steel mt-1">{m.label}</p>
              </div>
            ))}
          </div>
        </Link>
      )}

      {mealLine && (
        <p className={`font-body text-sm ${state.length > 0 ? "mb-3" : ""}`}>
          {mealHref ? (
            <Link href={mealHref} className="text-chalk underline underline-offset-2">
              {mealLine}
            </Link>
          ) : (
            mealLine
          )}
        </p>
      )}

      {error && (
        <p className="font-body text-xs text-rust-ink mb-2" role="alert">
          {error}
        </p>
      )}

      {state.length > 0 && (
        <div className="space-y-1.5 pt-3 border-t border-steel/15">
          {state.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => toggle(h.id, h.completed)}
              className="w-full min-h-11 py-1 flex items-center gap-2 text-left"
            >
              <span
                className={`w-5 h-5 shrink-0 border flex items-center justify-center ${
                  h.completed ? "bg-positive border-positive" : "border-steel/30"
                }`}
              >
                {h.completed && <Check className="w-3.5 h-3.5 text-graphite" strokeWidth={3} />}
              </span>
              <span className="font-body text-sm">{h.title}</span>
            </button>
          ))}
        </div>
      )}

      {pinnedLinks && pinnedLinks.length > 0 && (
        <div className="space-y-1.5 pt-3 border-t border-steel/15">
          <p className="font-body text-[13px] font-semibold text-steel">From your coach, for today</p>
          {pinnedLinks.map((l) => (
            <a
              key={l.id}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block font-body text-sm text-rust-ink underline underline-offset-2"
            >
              {l.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
