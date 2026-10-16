"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { DEFAULT_DOUBLE, clearDouble, describeDouble, saveDouble, validateDouble } from "@/lib/program-progression";
import type { DoubleProgressionConfig } from "@/lib/progressions";

// One exercise's own double progression, in its Edit details: the same rule and rep range the program-wide Progression choice writes, so a single exercise can differ from the rest.
export function ExerciseProgressionControl({
  workoutId,
  groupId,
  exerciseName,
  setIds,
  onSaved,
  onFlashSaved,
  onFlashError,
}: {
  workoutId: string;
  groupId: string;
  exerciseName: string;
  setIds: string[];
  onSaved: (low: number | null, high: number | null) => void;
  onFlashSaved: () => void;
  onFlashError: (message: string) => void;
}) {
  const [programId, setProgramId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null | undefined>(undefined);
  const [low, setLow] = useState(String(DEFAULT_DOUBLE.low));
  const [high, setHigh] = useState(String(DEFAULT_DOUBLE.high));
  const [increment, setIncrement] = useState(String(DEFAULT_DOUBLE.increment));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserClient();
    (async () => {
      const { data: w } = await supabase.from("workouts").select("program_id").eq("id", workoutId).maybeSingle();
      const pid = (w as { program_id?: string } | null)?.program_id ?? null;
      if (cancelled) return;
      setProgramId(pid);
      if (!pid) {
        setModel(null);
        return;
      }
      const { data: rule } = await supabase.from("exercise_progressions").select("model, config").eq("program_id", pid).eq("exercise_name", exerciseName).maybeSingle();
      if (cancelled) return;
      const r = rule as { model: string; config: DoubleProgressionConfig } | null;
      setModel(r?.model ?? null);
      if (r?.model === "double_progression") {
        setLow(String(r.config.repRangeLow));
        setHigh(String(r.config.repRangeHigh));
        setIncrement(String(r.config.weightIncrement));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workoutId, exerciseName]);

  const settings = { low: Number(low), high: Number(high), increment: Number(increment) };
  const problem = validateDouble(settings);

  async function save() {
    if (busy || !programId || problem) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setBusy(false);
      setError("You need to sign in again.");
      return;
    }
    const err = await saveDouble(supabase, { programId, groupId, userId: userData.user.id, names: [exerciseName], setIds, settings });
    setBusy(false);
    if (err) {
      setError(err);
      onFlashError(err);
      return;
    }
    setModel("double_progression");
    onSaved(settings.low, settings.high);
    onFlashSaved();
  }

  async function remove() {
    if (busy || !programId) return;
    setBusy(true);
    setError(null);
    const err = await clearDouble(createBrowserClient(), { programId, names: [exerciseName] });
    setBusy(false);
    if (err) {
      setError(err);
      onFlashError(err);
      return;
    }
    setModel(null);
    onFlashSaved();
  }

  if (model === undefined || !programId) return null;
  const other = model != null && model !== "double_progression";
  return (
    <div className="font-body text-xs text-steel space-y-1.5">
      <p className="uppercase tracking-wide">Progression for this exercise: {model === "double_progression" ? "Double progression" : other ? "another type (set on the Progression page)" : "none"}</p>
      {!other && (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Reps from</span>
            <input type="number" inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} aria-label="Reps from" className="w-14 h-8 bg-graphite border border-steel/30 text-chalk px-1 text-center focus:outline-none focus:border-rust" />
            <span>to</span>
            <input type="number" inputMode="numeric" value={high} onChange={(e) => setHigh(e.target.value)} aria-label="Reps to" className="w-14 h-8 bg-graphite border border-steel/30 text-chalk px-1 text-center focus:outline-none focus:border-rust" />
            <span>add</span>
            <input type="number" inputMode="decimal" value={increment} onChange={(e) => setIncrement(e.target.value)} aria-label="Pounds to add" className="w-14 h-8 bg-graphite border border-steel/30 text-chalk px-1 text-center focus:outline-none focus:border-rust" />
            <span>lb at the top</span>
          </div>
          <p>{problem ?? describeDouble(settings)}</p>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => void save()} disabled={busy || !!problem || setIds.length === 0} className="min-h-9 text-rust underline underline-offset-2 disabled:opacity-40">
              {model === "double_progression" ? "Update" : "Use double progression"}
            </button>
            {model === "double_progression" && (
              <button type="button" onClick={() => void remove()} disabled={busy} className="min-h-9 underline underline-offset-2 disabled:opacity-40">
                Turn off
              </button>
            )}
          </div>
          {setIds.length === 0 && <p>Add a set first.</p>}
        </>
      )}
      {error && (
        <p className="text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
