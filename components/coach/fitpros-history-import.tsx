"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { importKeys, parseFitprosExport, planFitprosImport, summarizePlan, weekOfDate } from "@/lib/fitpros-history";
import { WeightUnitChoice } from "@/components/coach/weight-unit-choice";
import type { WeightUnit } from "@/lib/weight-units";
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
import { settleImportedHistory, recomputeTrainingMaxes, unclearFoundLine } from "@/lib/unclear-points";
import { existingLibraryName } from "@/lib/exercise-search";
import { fitprosLayoutMessage, isNumericOnlyName, noSetsWarning } from "@/lib/exercise-name-guard";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// FitPros import: the coach picks the exported text file, sees exactly what would be written (a dry run: nothing is saved), and only then imports. Each workout is matched to the program
// day by its exercise list. Imported days show in History, not as ticked days on the calendar. Running it again never doubles anything, and "Undo this import" removes only what it wrote.
export function FitprosHistoryImport({ athleteId, groupId, athleteName }: { athleteId: string; groupId: string; athleteName: string }) {
  const router = useRouter();
  const [program, setProgram] = useState<ImportProgram | null | undefined>(undefined);
  const [existing, setExisting] = useState<ImportedSession[]>([]);
  // The file as read, and the unit the coach picked before choosing it (pounds unless changed; a file that writes lb or kg after its weights is read by what it says). The workouts are worked out from both.
  const [fileText, setFileText] = useState<string | null>(null);
  const [unit, setUnit] = useState<WeightUnit>("lb");
  const parsedFile = useMemo(() => (fileText ? parseFitprosExport(fileText, unit) : null), [fileText, unit]);
  // Lines that look like sets, not exercise names, stop the import: nothing is previewed or written until the file is fixed.
  const layoutProblem = parsedFile && parsedFile.problems.length > 0 ? fitprosLayoutMessage(parsedFile.problems) : null;
  const workouts = useMemo(() => {
    if (!parsedFile || layoutProblem) return null;
    return parsedFile.workouts.length > 0 ? parsedFile.workouts : null;
  }, [parsedFile, layoutProblem]);
  const [confirmedLayout, setConfirmedLayout] = useState(false);
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
  // Many exercises with no sets (and no note) mean the layout was probably misread: one explicit confirm before Import works.
  const noSetsText = summary ? noSetsWarning(summary.withoutSets, summary.exerciseLines) : null;
  const noSets = !!noSetsText && !confirmedLayout;
  const weekNow = effectiveStart ? weekOfDate(effectiveStart, todayKey()) : null;

  // Adds one imported name to the coach's library (never a second row for a spelling of one that is there), then the plan is matched again.
  async function addToLibrary(name: string) {
    if (busy) return;
    if (isNumericOnlyName(name)) {
      setError("A name made only of numbers can't be added to your library.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    const { data: library } = await supabase.from("exercise_library").select("name");
    const taken = existingLibraryName(name, (library ?? []).map((r) => r.name as string));
    if (!taken && userData.user) {
      const { error: insertError } = await supabase.from("exercise_library").insert({ created_by: userData.user.id, name: name.trim() });
      if (insertError) setError("Couldn't add that to your library. Try again.");
    }
    if (plan) setPlan(await markLibrary(supabase, plan));
    setBusy(false);
  }

  async function onFile(file: File | null) {
    setMessage(null);
    setError(null);
    setMoveStart(false);
    setConfirmedLayout(false);
    if (!file) return;
    const text = await file.text();
    const parsed = parseFitprosExport(text, unit);
    if (parsed.workouts.length === 0 && parsed.problems.length === 0) {
      setFileText(null);
      setError("That file has no workouts in it. Use the FitPros text export.");
      return;
    }
    setFileText(text);
  }

  async function runImport() {
    if (!workouts || !program || busy || noSets) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createBrowserClient();
    // The start date the import is matched against: moved first (and checked in the database), never assumed.
    let start = program.startDate;
    let moved = false;
    if (moveStart && firstDate) {
      const stored = await moveProgramStart(supabase, program.programId, firstDate);
      if (stored !== firstDate) {
        setBusy(false);
        setError(`The program start did NOT move to ${firstDate}, so nothing was imported. Try again, and tell us if it happens again.`);
        return;
      }
      start = stored;
      moved = true;
    }
    // The plan is made again here from exactly that start date, so what is written is what was just confirmed, never a screen that is a moment out of date.
    const finalPlan = planFitprosImport(workouts, program.workouts, start, new Set(program.takenWorkoutIds));
    const result = await runFitprosImport(supabase, { athleteId, groupId, plan: finalPlan, existingKeys });
    // Jumbled or impossible sets are marked (kept as entered, not counted) by one check in the database; then what counts is folded into the training maxes.
    const unclear = result.imported > 0 ? await settleImportedHistory(supabase, groupId, athleteId) : 0;
    setBusy(false);
    const linked = finalPlan.filter((w) => w.programWorkoutId).length;
    setMessage(`Imported ${result.imported} workout${result.imported === 1 ? "" : "s"}${result.skippedAlreadyThere ? `, ${result.skippedAlreadyThere} already there` : ""} (${linked} matched to program days, ${finalPlan.length - linked} plain history).${moved ? ` The program start is now ${start}.` : ""}${result.failed.length ? ` ${result.failed.length} did not save: ${result.failed.join("; ")}` : ""}${unclear > 0 ? ` ${unclearFoundLine(unclear)}` : ""}`);
    await reload();
    router.refresh();
  }

  async function undo() {
    if (busy) return;
    if (!(await confirmDialog({ message: `Remove the ${existing.length} workout${existing.length === 1 ? "" : "s"} imported from FitPros for ${athleteName}? Anything else in their history stays. Their totals, graphs, estimated maxes and records are worked out again without it.`, confirmLabel: "Remove import", destructive: true }))) return;
    setBusy(true);
    const supabase = createBrowserClient();
    const result = await undoFitprosImport(supabase, groupId, athleteId);
    if (!result.error && result.removed > 0) await recomputeTrainingMaxes(supabase, athleteId);
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
      <h2 className="font-display uppercase text-sm tracking-wide text-steel">FitPros</h2>
      <p className="font-body text-sm text-steel mt-1 max-w-2xl">
        Choose the FitPros history file for {athleteName}. You see what would be saved first; nothing is saved until you press Import. The star rating and workout notes are left out.
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
          <div className="mt-3">
            <WeightUnitChoice value={unit} onChange={setUnit} />
          </div>
          <label className="mt-3 inline-flex min-h-11 items-center font-body text-sm cursor-pointer">
            <span className="border border-steel/40 px-3 py-2 text-chalk">Choose the FitPros file</span>
            <input type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
          </label>

          {layoutProblem && (
            <p className="font-body text-sm text-rust mt-4" role="alert">
              {layoutProblem}
            </p>
          )}
          {plan && summary && (
            <div className="mt-4 space-y-4">
              <p className="font-body text-sm text-chalk">
                {summary.workouts} workouts, {summary.exerciseLines} exercise lines, about {summary.sets} sets. {summary.linked} matched to a program day, {summary.unlinked} will be plain history.
                {existing.length > 0 ? ` ${existing.length} already imported.` : ""}
              </p>

              {needsEarlierStart && firstDate && !moveStart && (
                <p className="font-body text-sm text-rust" role="alert">
                  These workouts start on {firstDate}, before the program starts{currentStart ? ` (${currentStart})` : ""}. Nothing before the start can be matched to a program day, so it will import as plain history. Tick the box below to move the start.
                </p>
              )}
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
                  <p className="text-chalk">Not in your library (imported as the names written; the same exercise under another name was matched for you):</p>
                  <ul className="mt-1 flex flex-wrap gap-x-4">
                    {notInLibrary.map((name) => (
                      <li key={name} className="flex items-center gap-2">
                        <span>{name}</span>
                        <button type="button" disabled={busy} onClick={() => void addToLibrary(name)} className="min-h-11 text-rust underline underline-offset-2 disabled:opacity-40">
                          Add to library
                        </button>
                      </li>
                    ))}
                  </ul>
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

              {noSetsText && (
                <div className="border border-rust/50 p-3 font-body text-sm" role="alert">
                  <p className="text-rust">{noSetsText}</p>
                  <label className="flex items-start gap-2 min-h-11 cursor-pointer mt-1">
                    <input type="checkbox" checked={confirmedLayout} onChange={(e) => setConfirmedLayout(e.target.checked)} className="mt-1" />
                    <span>Import anyway</span>
                  </label>
                </div>
              )}

              <button type="button" disabled={busy || toImport === 0 || noSets} onClick={() => void runImport()} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 disabled:opacity-40">
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
