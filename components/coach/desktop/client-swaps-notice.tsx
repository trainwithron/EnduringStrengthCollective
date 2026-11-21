"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { undoEveryWeekSwap } from "@/lib/every-week-swap";
import type { BuilderDay } from "@/lib/types";

interface Swap {
  id: string;
  from_name: string;
  to_name: string;
  created_at: string;
  by_user: string | null;
  changes: { id: string; exercise_name: string; display_name: string | null }[];
}

const SHOW_DAYS = 30;

// A client changed an exercise for every week of their own program during a workout (B5): one line for each, from the last 30 days, with Undo. The coach's notice opens this page.
// Undo puts back exactly what the swap changed (undo_exercise_swap); an exercise changed again since is left as it is. Before step 219 there is nothing to show.
export function ClientSwapsNotice({ programId, onDaysChange }: { programId: string; onDaysChange: (fn: (prev: BuilderDay[]) => BuilderDay[]) => void }) {
  const [swaps, setSwaps] = useState<(Swap & { who: string })[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      const since = new Date(Date.now() - SHOW_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("program_exercise_swaps")
        .select("id, from_name, to_name, created_at, by_user, changes")
        .eq("program_id", programId)
        .eq("by_client", true)
        .is("undone_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error || !data || data.length === 0 || cancelled) return;
      const ids = Array.from(new Set((data as Swap[]).map((s) => s.by_user).filter((x): x is string => !!x)));
      const { data: people } = ids.length > 0 ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
      const nameOf = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, (p.full_name ?? "").trim().split(" ")[0] || "Your client"]));
      if (!cancelled) setSwaps((data as Swap[]).map((s) => ({ ...s, who: (s.by_user && nameOf.get(s.by_user)) || "Your client" })));
    })();
    return () => {
      cancelled = true;
    };
  }, [programId]);

  async function undo(s: Swap) {
    if (busy) return;
    setBusy(s.id);
    setNote(null);
    const back = await undoEveryWeekSwap(createBrowserClient(), s.id);
    setBusy(null);
    if (back === null) {
      setNote("Couldn't undo that. Try again.");
      return;
    }
    // the builder shows only what the database put back, each with its own name again
    const restored = new Map(back.map((r) => [r.id, r]));
    onDaysChange((prev) =>
      prev.map((d) => ({
        ...d,
        items: d.items.map((i) => {
          const r = i.kind === "exercise" ? restored.get(i.id) : undefined;
          return r && i.kind === "exercise" ? { ...i, exerciseName: r.exerciseName, displayName: r.displayName } : i;
        }),
      }))
    );
    setSwaps((prev) => prev.filter((x) => x.id !== s.id));
    setNote(`Put back ${s.from_name} (${back.length} exercise${back.length === 1 ? "" : "s"}).`);
  }

  if (swaps.length === 0 && !note) return null;
  return (
    <section className="mt-3 border border-steel/25 bg-surface rounded-card p-3 space-y-2" aria-label="Exercises your client swapped" data-client-swaps>
      {swaps.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="font-body text-sm text-chalk flex-1 min-w-[12rem]">
            {s.who} swapped {s.from_name} for {s.to_name} for every week.
          </p>
          <button type="button" onClick={() => void undo(s)} disabled={busy === s.id} className="min-h-11 px-4 border border-steel/40 font-body text-sm text-chalk hover:border-rust disabled:opacity-40">
            {busy === s.id ? "Undoing..." : "Undo"}
          </button>
        </div>
      ))}
      {note && (
        <p className="font-body text-xs text-steel" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
