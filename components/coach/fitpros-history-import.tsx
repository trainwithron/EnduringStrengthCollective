"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { importKeys, parseFitprosExport, planFitprosImport, summarizePlan, weekOfDate, type FitprosWorkout } from "@/lib/fitpros-history";
import {
  listImportedSessions,
  loadProgramForImport,
  markLibrary,
  moveProgramStart,
  runFitprosImport,
  undoFitprosImport,
  type ImportProgram,
  type ImportedSession,
} from "@/lib/fitpros-history-import";
import type { PlannedWorkout } from "@/lib/fitpros-history";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "Import from FitPros": the coach picks the exported text file, sees exactly what would be written (a dry run: nothing is saved), and only then imports. Each workout is matched to the program
// day by its exercise list. Imported days show in History, not as ticked days on the calendar. Running it again never doubles anything, and "Undo this import" removes only what it wrote.
export function FitprosHistoryImport({ athleteId, groupId, athleteName }: { athleteId: string; groupId: string; athleteName: string }) {
  const router = useRouter();
  const [program, setProgram] = useState<ImportProgram | null | undefined>(undefined);
  const [existing, setExisting] = useState<ImportedSession[]>([]);
  const [workouts, setWorkouts] = useState<FitprosWorkout[] | null>(null);
  const [plan, setPlan] = useState<PlannedWorkout[] | null>(null);
  const [moveStart, setMoveStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const supabase = createBrowserClient();
    const [p, e] = await Promise.all([loadProgramForImport(supabase, groupId, athleteId), listImportedSessions(supabase, groupId, athleteId)]);
    setProgram(p);
    setExisting(e);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, groupId]);

  const firstDate = workouts && workouts.length > 0 ? workouts.map((w) => w.date).sort()[0] : null;
  const currentStart = program?.startDate ?? null;
  const needsEarlierStart = !!firstDate && (!currentStart || firstDate < currentStart);
  const effectiveStart = moveStart && firstDate ? firstDate : currentStart;
  const lastWeek = program ? Math.max(0, ...program.workouts.map((w) => w.weekNumber)) : 0;

  // The plan is computed again whenever the file or the chosen start date changes.
  useEffect(() => {
    if (!workouts || !program) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    const base = planFitprosImport(workouts, program.workouts, effectiveStart, new Set(program.takenWorkoutIds));
    void markLibrary(createBrowserClient(), base).then((marked) => {
      if (!cancelled) setPlan(marked);
    });
    return () => {
      cancelled = true;
    };
  }, [workouts, program, effectiveStart]);

  const keys = useMemo(() => (plan ? importKeys(plan) : []), [plan]);
  const existingKeys = useMemo(() => new Set(existing.map((s) => s.key)), [existing]);
  const summary = plan ? summarizePlan(plan) : null;
  const toImport = plan ? plan.filter((_, i) => !existingKeys.has(keys[i])).length : 0;
  const notInLibrary = plan ? Array.from(new Set(plan.flatMap((w) => w.exercises.filter((e) => e.inLibrary === false && !e.programExerciseId).map((e) => e.savedName)))) : [];
  const weekNow = effectiveStart ? weekOfDate(effectiveStart, todayKey()) : null;

  async function onFile(file: File | null) {
    setMessage(null);
    setError(null);
    setMoveStart(false);
    if (!file) return;
    const text = await file.text();
    const parsed = parseFitprosExport(text);
    if (parsed.workouts.length === 0) {
      setWorkouts(null);
      setError("That file has no workouts in it. Use the FitPros text export.");
      return;
    }
    setWorkouts(parsed.workouts);
  }

  async function runImport() {
    if (!plan || !program || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createBrowserClient();
    if (moveStart && firstDate) {
      const ok = await moveProgramStart(supabase, program.programId, firstDate);
      if (!ok) {
        setBusy(false);
        setError("Couldn't move the program start. Nothing was imported.");
        return;
      }
    }
    const result = await runFitprosImport(supabase, { athleteId, groupId, plan, existingKeys });
    setBusy(false);
    setMessage(`Imported ${result.imported} workout${result.imported === 1 ? "" : "s"}${result.skippedAlreadyThere ? `, ${result.skippedAlreadyThere} already there` : ""}.${result.failed.length ? ` ${result.failed.length} did not save: ${result.failed.join("; ")}` : ""}`);
    await reload();
    router.refresh();
  }

  async function undo() {
    if (busy) return;
    if (!(await confirmDialog({ message: `Remove the ${existing.length} workout${existing.length === 1 ? "" : "s"} imported from FitPros for ${athleteName}? Anything else in their history stays.`, confirmLabel: "Remove import", destructive: true }))) return;
    setBusy(true);
    const supabase = createBrowserClient();
    const result = await undoFitprosImport(supabase, groupId, athleteId);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage(`Removed ${result.removed} imported workout${result.removed === 1 ? "" : "s"}.`);
    await reload();
    router.refresh();
  }

  return (
    <section className="border border-steel/20 p-4 mt-8 max-w-3xl">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel">Import from FitPros</h2>
      <p className="font-body text-sm text-steel mt-1 max-w-2xl">
        Choose the FitPros history file for {athleteName}. You see what would be saved first; nothing is saved until you press Import. Imported workouts show in History, are not counted as new records, and send no notifications. The star rating and workout notes are left out.
      </p>

      {program === undefined ? (
        <p className="font-body text-sm text-steel mt-3">Loading…</p>
      ) : program === null ? (
        <p className="font-body text-sm text-chalk mt-3">{athleteName} has no active program here. Assign the program first so each workout can be matched to its day.</p>
      ) : (
        <>
          <p className="font-body text-xs text-steel mt-3">
            Program: <span className="text-chalk">{program.name}</span> · {currentStart ? `starts ${currentStart}` : "no start date"}
          </p>
          <label className="mt-3 inline-flex min-h-11 items-center font-body text-sm cursor-pointer">
            <span className="border border-steel/40 px-3 py-2 text-chalk">Choose the FitPros file</span>
            <input type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
          </label>

          {plan && summary && (
            <div className="mt-4 space-y-4">
              <p className="font-body text-sm text-chalk">
                {summary.workouts} workouts, {summary.exerciseLines} exercise lines, about {summary.sets} sets. {summary.linked} matched to a program day, {summary.unlinked} will be plain history.
                {existing.length > 0 ? ` ${existing.length} already imported.` : ""}
              </p>

              {needsEarlierStart && firstDate && (
                <div className="border border-steel/30 p-3 font-body text-sm">
                  <label className="flex items-start gap-2 min-h-11 cursor-pointer">
                    <input type="checkbox" checked={moveStart} onChange={(e) => setMoveStart(e.target.checked)} className="mt-1" />
                    <span>
                      Move the program start to {firstDate} so the history lines up with its weeks.
                      {weekNow != null && lastWeek > 0 && (
                        <span className="block text-steel text-xs mt-1">
                          {moveStart ? `Today would be week ${weekNow} of ${lastWeek}.` : currentStart ? `Today is week ${weekOfDate(currentStart, todayKey())} of ${lastWeek} now.` : "The program has no start date now."}
                        </span>
                      )}
                    </span>
                  </label>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full font-body text-xs">
                  <thead>
                    <tr className="text-left text-steel">
                      <th className="py-1 pr-3 font-normal">Date</th>
                      <th className="py-1 pr-3 font-normal">Matches</th>
                      <th className="py-1 pr-3 font-normal">Exercises</th>
                      <th className="py-1 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.map((w, i) => (
                      <tr key={keys[i]} className="border-t border-steel/15 align-top">
                        <td className="py-1.5 pr-3 text-chalk whitespace-nowrap">{w.date}</td>
                        <td className="py-1.5 pr-3 text-chalk">{w.programWorkoutId ? `Week ${w.weekNumber} · Day ${w.dayIndex}` : "Plain history"}</td>
                        <td className="py-1.5 pr-3 text-steel">{w.exercises.length}</td>
                        <td className="py-1.5 text-steel">{existingKeys.has(keys[i]) ? "Already imported" : "Will import"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {notInLibrary.length > 0 && (
                <div className="font-body text-xs text-steel">
                  <p className="text-chalk">Not in your library (imported as plain names): {notInLibrary.join(", ")}</p>
                </div>
              )}
              {summary.flags.length > 0 && (
                <details className="font-body text-xs text-steel">
                  <summary className="cursor-pointer text-chalk">{summary.flags.length} things to look at</summary>
                  <ul className="mt-2 list-disc pl-5 space-y-1">
                    {summary.flags.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </details>
              )}

              <button type="button" disabled={busy || toImport === 0} onClick={() => void runImport()} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 disabled:opacity-40">
                {busy ? "Importing…" : toImport === 0 ? "Nothing new to import" : `Import ${toImport} workout${toImport === 1 ? "" : "s"}`}
              </button>
            </div>
          )}

          {existing.length > 0 && (
            <div className="mt-4">
              <button type="button" disabled={busy} onClick={() => void undo()} className="min-h-11 font-body text-sm text-rust underline underline-offset-2 disabled:opacity-40">
                Undo this import ({existing.length} workout{existing.length === 1 ? "" : "s"})
              </button>
            </div>
          )}
        </>
      )}

      {message && (
        <p className="font-body text-sm text-chalk mt-3" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="font-body text-sm text-rust mt-3" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
