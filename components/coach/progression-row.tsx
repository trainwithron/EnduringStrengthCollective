"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import type {
  DoubleProgressionConfig,
  LinearConfig,
  ProgressionModel,
  ProgressionUnit,
  WaveConfig,
} from "@/lib/progressions";

interface ExistingProgression {
  id: string;
  exercise_name: string;
  model: ProgressionModel;
  config: LinearConfig | WaveConfig | DoubleProgressionConfig;
}

function summarize(existing: ExistingProgression | null): string {
  if (!existing) return "No progression set";
  const unit = existing.config.unit === "percent" ? "%" : "lbs";

  if (existing.model === "linear") {
    const c = existing.config as LinearConfig;
    return `Linear · +${c.weightIncrement}${unit}/occurrence${
      c.repIncrement ? `, +${c.repIncrement} reps` : ""
    }`;
  }
  if (existing.model === "wave") {
    const c = existing.config as WaveConfig;
    return `Wave · reps ${c.repsPattern.join(",")} · weight ${c.weightDeltas
      .map((d) => (d >= 0 ? `+${d}` : d))
      .join(",")}${unit}`;
  }
  const c = existing.config as DoubleProgressionConfig;
  return `Double progression · ${c.repRangeLow}-${c.repRangeHigh} reps, +${c.weightIncrement}${unit}`;
}

function numberList(input: string): number[] {
  return input
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
}

export function ProgressionRow({
  groupId,
  programId,
  exerciseName,
  existing,
}: {
  groupId: string;
  programId: string;
  exerciseName: string;
  existing: ExistingProgression | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [model, setModel] = useState<ProgressionModel>(existing?.model ?? "linear");
  const [unit, setUnit] = useState<ProgressionUnit>(existing?.config.unit ?? "lbs");

  const linearDefaults = existing?.model === "linear" ? (existing.config as LinearConfig) : null;
  const [weightIncrement, setWeightIncrement] = useState(
    String(linearDefaults?.weightIncrement ?? 5)
  );
  const [repIncrement, setRepIncrement] = useState(String(linearDefaults?.repIncrement ?? 0));

  const waveDefaults = existing?.model === "wave" ? (existing.config as WaveConfig) : null;
  const [weightDeltas, setWeightDeltas] = useState(
    waveDefaults?.weightDeltas.join(",") ?? "0,10,-5,15"
  );
  const [repsPattern, setRepsPattern] = useState(waveDefaults?.repsPattern.join(",") ?? "5,3,5,3");

  const doubleDefaults =
    existing?.model === "double_progression" ? (existing.config as DoubleProgressionConfig) : null;
  const [repRangeLow, setRepRangeLow] = useState(String(doubleDefaults?.repRangeLow ?? 8));
  const [repRangeHigh, setRepRangeHigh] = useState(String(doubleDefaults?.repRangeHigh ?? 12));
  const [dpWeightIncrement, setDpWeightIncrement] = useState(
    String(doubleDefaults?.weightIncrement ?? 5)
  );

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSave() {
    setSubmitting(true);
    setError(null);

    let config: LinearConfig | WaveConfig | DoubleProgressionConfig;
    if (model === "linear") {
      config = {
        weightIncrement: Number(weightIncrement) || 0,
        repIncrement: Number(repIncrement) || 0,
        unit,
      };
    } else if (model === "wave") {
      const deltas = numberList(weightDeltas);
      const reps = numberList(repsPattern);
      if (deltas.length === 0 || reps.length === 0) {
        setError("Enter at least one value in each list.");
        setSubmitting(false);
        return;
      }
      config = { weightDeltas: deltas, repsPattern: reps, unit };
    } else {
      const low = Number(repRangeLow) || 0;
      const high = Number(repRangeHigh) || 0;
      if (low >= high) {
        setError("Rep range low must be less than high.");
        setSubmitting(false);
        return;
      }
      config = { repRangeLow: low, repRangeHigh: high, weightIncrement: Number(dpWeightIncrement) || 0, unit };
    }

    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setSubmitting(false);
      return;
    }

    const { error: upsertError } = await supabase.from("exercise_progressions").upsert(
      {
        program_id: programId,
        group_id: groupId,
        exercise_name: exerciseName,
        model,
        config,
        created_by: userData.user.id,
      },
      { onConflict: "program_id,exercise_name" }
    );

    if (upsertError) {
      setError(upsertError.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setExpanded(false);
    router.refresh();
  }

  async function handleRemove() {
    if (!existing) return;
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase
      .from("exercise_progressions")
      .delete()
      .eq("id", existing.id);

    if (deleteError) {
      setError(deleteError.message);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setExpanded(false);
    router.refresh();
  }

  return (
    <div className="py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="font-body font-medium text-[15px]">{exerciseName}</span>
        <span className="font-body text-xs text-steel">{summarize(existing)}</span>
      </button>

      {expanded && (
        <div className="mt-3 border border-steel/20 p-3 space-y-3">
          <div>
            <label className="font-body text-xs text-steel uppercase tracking-wide">Model</label>
            <div className="flex gap-2 mt-1">
              {(["linear", "wave", "double_progression"] as ProgressionModel[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModel(m)}
                  className={`h-9 px-3 border font-body text-xs ${
                    model === m
                      ? "bg-rust border-rust text-graphite"
                      : "border-steel/30 text-steel"
                  }`}
                >
                  {m === "linear" ? "Linear" : m === "wave" ? "Wave" : "Double progression"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="font-body text-xs text-steel uppercase tracking-wide">Unit</label>
            <div className="flex gap-2 mt-1">
              {(["lbs", "percent"] as ProgressionUnit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnit(u)}
                  className={`h-9 px-3 border font-body text-xs ${
                    unit === u ? "bg-rust border-rust text-graphite" : "border-steel/30 text-steel"
                  }`}
                >
                  {u === "lbs" ? "lbs" : "%"}
                </button>
              ))}
            </div>
          </div>

          {model === "linear" && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="font-body text-xs text-steel uppercase tracking-wide">
                  Weight increment / occurrence
                </label>
                <input
                  type="number"
                  value={weightIncrement}
                  onChange={(e) => setWeightIncrement(e.target.value)}
                  className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
                />
              </div>
              <div className="flex-1">
                <label className="font-body text-xs text-steel uppercase tracking-wide">
                  Rep increment / occurrence
                </label>
                <input
                  type="number"
                  value={repIncrement}
                  onChange={(e) => setRepIncrement(e.target.value)}
                  className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
                />
              </div>
            </div>
          )}

          {model === "wave" && (
            <div className="space-y-2">
              <div>
                <label className="font-body text-xs text-steel uppercase tracking-wide">
                  Rep scheme (repeats, e.g. 5,3,5,3)
                </label>
                <input
                  type="text"
                  value={repsPattern}
                  onChange={(e) => setRepsPattern(e.target.value)}
                  className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
                />
              </div>
              <div>
                <label className="font-body text-xs text-steel uppercase tracking-wide">
                  Weight deltas from occurrence 1 (repeats, e.g. 0,10,-5,15)
                </label>
                <input
                  type="text"
                  value={weightDeltas}
                  onChange={(e) => setWeightDeltas(e.target.value)}
                  className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
                />
              </div>
            </div>
          )}

          {model === "double_progression" && (
            <div className="flex gap-2">
              <div className="w-20">
                <label className="font-body text-xs text-steel uppercase tracking-wide">Low</label>
                <input
                  type="number"
                  value={repRangeLow}
                  onChange={(e) => setRepRangeLow(e.target.value)}
                  className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm text-center focus:outline-none focus:border-rust"
                />
              </div>
              <div className="w-20">
                <label className="font-body text-xs text-steel uppercase tracking-wide">High</label>
                <input
                  type="number"
                  value={repRangeHigh}
                  onChange={(e) => setRepRangeHigh(e.target.value)}
                  className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm text-center focus:outline-none focus:border-rust"
                />
              </div>
              <div className="flex-1">
                <label className="font-body text-xs text-steel uppercase tracking-wide">
                  Weight increment on success
                </label>
                <input
                  type="number"
                  value={dpWeightIncrement}
                  onChange={(e) => setDpWeightIncrement(e.target.value)}
                  className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
            {existing && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={submitting}
                className="font-body text-xs text-steel active:text-rust transition-colors"
              >
                Remove progression
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
