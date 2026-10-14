"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  UNCLEAR_COUNTED_LABEL,
  UNCLEAR_LABEL,
  fixUnclearPoint,
  flagUnclearSets,
  recomputeTrainingMaxes,
  listUnclearPoints,
  setUnclearPointCounted,
  type UnclearPoint,
} from "@/lib/unclear-points";

function numberOrNull(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

// The unclear data points of imported history for one client. Each is kept exactly as entered with a question mark; it is not counted anywhere until the coach counts it (or fixes it and counts it).
// Opening this page also runs the check once for the client's history (it only adds marks, so history a client uploaded themselves is checked too).
export function UnclearPointsReview({ athleteId, groupId, initial }: { athleteId: string; groupId: string; initial: UnclearPoint[] }) {
  const router = useRouter();
  const [points, setPoints] = useState<UnclearPoint[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [weightText, setWeightText] = useState("");
  const [repsText, setRepsText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setPoints(await listUnclearPoints(createBrowserClient(), groupId, athleteId));
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createBrowserClient();
      const marked = await flagUnclearSets(supabase, groupId, athleteId);
      if (marked > 0 && !cancelled) {
        await recomputeTrainingMaxes(supabase, athleteId);
        await reload();
        router.refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, groupId]);

  async function decide(id: string, counts: boolean) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    const problem = await setUnclearPointCounted(createBrowserClient(), id, counts);
    setBusyId(null);
    if (problem) {
      setError(problem);
      return;
    }
    await reload();
    router.refresh();
  }

  async function saveFix(id: string) {
    if (busyId) return;
    const weight = numberOrNull(weightText);
    const reps = numberOrNull(repsText);
    if (Number.isNaN(weight) || Number.isNaN(reps)) {
      setError("Use numbers only.");
      return;
    }
    setBusyId(id);
    setError(null);
    const problem = await fixUnclearPoint(createBrowserClient(), id, weight, reps);
    setBusyId(null);
    if (problem) {
      setError(problem);
      return;
    }
    setFixing(null);
    await reload();
    router.refresh();
  }

  if (points.length === 0) return null;
  const open = points.filter((p) => p.flag === "unclear").length;

  return (
    <section className="border border-steel/20 p-4 mt-8 max-w-3xl" aria-labelledby="unclear-points-heading">
      <h2 id="unclear-points-heading" className="font-display uppercase text-sm tracking-wide text-steel">
        Unclear data points
      </h2>
      <p className="font-body text-sm text-steel mt-1 max-w-2xl">
        These imported sets look jumbled or unlikely. They are kept exactly as entered, but left out of every total, graph, estimated max and record until you count them.
        {open === 0 ? " You have decided all of them." : ""}
      </p>
      <ul className="mt-3 divide-y divide-steel/15">
        {points.map((p) => (
          <li key={p.id} className="py-3 font-body text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-chalk">
                {p.exerciseName}
                <span className="text-steel text-xs"> · {p.date}</span>
              </span>
              <span className="text-chalk" aria-label={`${p.weight ?? "no"} weight, ${p.reps ?? "no"} reps`}>
                {p.weight ?? "–"} × {p.reps ?? "–"} <span aria-hidden>?</span>
              </span>
            </div>
            <p className="text-xs text-steel mt-0.5">
              {p.flag === "unclear" ? UNCLEAR_LABEL : UNCLEAR_COUNTED_LABEL}
              {p.reason ? ` · ${p.reason}` : ""}
            </p>
            {fixing === p.id ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-xs text-steel">
                  Weight
                  <input value={weightText} onChange={(e) => setWeightText(e.target.value)} inputMode="decimal" className="mt-1 block h-11 w-24 bg-graphite border border-steel/30 text-chalk px-2" />
                </label>
                <label className="text-xs text-steel">
                  Reps
                  <input value={repsText} onChange={(e) => setRepsText(e.target.value)} inputMode="numeric" className="mt-1 block h-11 w-20 bg-graphite border border-steel/30 text-chalk px-2" />
                </label>
                <button type="button" disabled={busyId === p.id} onClick={() => void saveFix(p.id)} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-3 disabled:opacity-40">
                  Save and count it
                </button>
                <button type="button" onClick={() => setFixing(null)} className="min-h-11 text-steel underline underline-offset-2">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-x-4">
                {p.flag === "unclear" ? (
                  <button type="button" disabled={busyId === p.id} onClick={() => void decide(p.id, true)} className="min-h-11 text-rust underline underline-offset-2 disabled:opacity-40">
                    Count it
                  </button>
                ) : (
                  <button type="button" disabled={busyId === p.id} onClick={() => void decide(p.id, false)} className="min-h-11 text-rust underline underline-offset-2 disabled:opacity-40">
                    Leave it out
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setFixing(p.id);
                    setWeightText(p.weight == null ? "" : String(p.weight));
                    setRepsText(p.reps == null ? "" : String(p.reps));
                  }}
                  className="min-h-11 text-steel underline underline-offset-2"
                >
                  Fix by hand
                </button>
                <Link href={`/sessions/${p.sessionId}`} className="min-h-11 inline-flex items-center text-steel underline underline-offset-2">
                  Open the workout
                </Link>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="font-body text-sm text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
