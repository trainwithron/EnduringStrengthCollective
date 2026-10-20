"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { ExerciseNameInput } from "@/components/coach/exercise-name-input";
import { detectHistoryColumns, headerUnitOf, parseHistoryRows, type ParsedHistoryRow, type SkippedHistoryRow } from "@/lib/history-import-parser";
import { SET_VALUE_LIMITS } from "@/lib/set-value-limits";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { WeightUnitChoice } from "@/components/coach/weight-unit-choice";
import { poundsFrom, type WeightUnit } from "@/lib/weight-units";
import {
  insertManualHistoryEntry,
  importHistoryRows,
  listHistoricalEntries,
  deleteHistoricalSession,
  undoImportBatch,
  type HistoricalEntryGroup,
} from "@/lib/exercise-history-import";
import { recomputeTrainingMaxes, settleImportedHistory } from "@/lib/unclear-points";
import { NUMERIC_NAMES_MESSAGE, exerciseNameProblem } from "@/lib/exercise-name-guard";

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Reused, unchanged, by both the coach's own upload page and the
// athlete's optional one-time self-entry page
// (coach_onboarding_history_ingestion_scoping_sept19.md's locked design
// #2: "same UI, not a separate client-facing build"). Every write goes
// through the caller's own session — RLS already allows a coach to write
// on behalf of an athlete in their group (sessions_insert_own_or_coach
// et al.), and an athlete always writes their own rows regardless, so
// this component never needs to know which kind of viewer it's running
// under beyond the copy it shows.
export function ExerciseHistoryUploader({
  athleteId,
  groupId,
  exerciseSuggestions,
  viewerIsCoach,
  parts = { quick: true, spreadsheet: true, entries: true },
}: {
  athleteId: string;
  groupId: string;
  exerciseSuggestions: string[];
  viewerIsCoach: boolean;
  // Which blocks to show. The coach's History page shows Quick entry and the entries list here and opens the spreadsheet import from its one Import button.
  parts?: { quick?: boolean; spreadsheet?: boolean; entries?: boolean };
}) {
  const [entries, setEntries] = useState<HistoricalEntryGroup[] | null>(null);

  async function refreshEntries() {
    const supabase = createBrowserClient();
    setEntries(await listHistoricalEntries(supabase, athleteId));
  }

  useEffect(() => {
    refreshEntries();
    // The spreadsheet import (opened from the Import button, a separate copy of this component) tells the list to look again.
    const again = () => void refreshEntries();
    window.addEventListener("history-entries-changed", again);
    return () => window.removeEventListener("history-entries-changed", again);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId]);

  // Pounds or kilograms for what is typed or uploaded here (pounds unless changed). A file that names its own unit wins.
  const [quickUnit, setQuickUnit] = useState<WeightUnit>("lb");
  const [csvUnit, setCsvUnit] = useState<WeightUnit>("lb");

  // ---- Manual quick-entry -------------------------------------------
  const [manualExercise, setManualExercise] = useState("");
  const [manualWeight, setManualWeight] = useState("");
  const [manualReps, setManualReps] = useState("");
  const [manualRpe, setManualRpe] = useState("");
  const [manualDate, setManualDate] = useState(todayDateKey());
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const canSubmitManual =
    manualExercise.trim().length > 0 && manualDate.length > 0 && (manualWeight.trim() || manualReps.trim());

  async function handleManualSubmit() {
    if (!canSubmitManual || manualSaving) return;
    setManualError(null);

    const weightLb = manualWeight.trim() && Number.isFinite(parseFloat(manualWeight)) ? poundsFrom(parseFloat(manualWeight), quickUnit) : null;
    const repsNumber = manualReps.trim() ? parseInt(manualReps, 10) : null;
    const rpeNumber = manualRpe.trim() ? parseFloat(manualRpe) : null;
    // The database refuses numbers no real set can be; say so here in plain words instead of failing to save.
    if (weightLb != null && (weightLb < 0 || weightLb > SET_VALUE_LIMITS.weightLb)) return setManualError(`A weight can be at most ${quickUnit === "kg" ? "907 kg" : "2,000 lbs"}.`);
    if (repsNumber != null && (!Number.isFinite(repsNumber) || repsNumber < 0 || repsNumber > SET_VALUE_LIMITS.reps)) return setManualError("Reps can be a whole number from 0 to 1,000.");
    if (rpeNumber != null && (!Number.isFinite(rpeNumber) || rpeNumber < 0 || rpeNumber > SET_VALUE_LIMITS.rpe)) return setManualError("RPE can be from 0 to 10.");
    setManualSaving(true);

    const supabase = createBrowserClient();
    const { error } = await insertManualHistoryEntry(supabase, {
      athleteId,
      groupId,
      exerciseName: manualExercise.trim(),
      weight: weightLb,
      reps: repsNumber,
      rpe: rpeNumber,
      date: manualDate,
    });

    setManualSaving(false);
    if (error) {
      setManualError(error);
      return;
    }

    await settleImportedHistory(supabase, groupId, athleteId);
    setManualExercise("");
    setManualWeight("");
    setManualReps("");
    setManualRpe("");
    await refreshEntries();
  }

  // ---- CSV import ------------------------------------------------------
  const [csvStatus, setCsvStatus] = useState<"idle" | "reviewing" | "importing" | "error">("idle");
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<ParsedHistoryRow[]>([]);
  // Every row the file had that was not read, with its row number and why (the coach fixes the file and brings it in again).
  const [csvSkipped, setCsvSkipped] = useState<SkippedHistoryRow[]>([]);
  // One id for this import, so all of it can be taken back at once; a second try of only the unsaved rows keeps it.
  const [csvBatchId, setCsvBatchId] = useState<string | null>(null);
  // After an import where some rows did not save: what was saved, and what is still waiting (the file stays open on only those rows).
  const [csvNotice, setCsvNotice] = useState<string | null>(null);

  async function handleCsvFile(file: File) {
    setCsvStatus("idle");
    setCsvError(null);

    const buffer = await file.arrayBuffer();
    // The spreadsheet reader is loaded only when a file is read (it is large, and most visits to the history page never import anything).
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "array", codepage: 65001 });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });

    if (rows.length < 2) {
      setCsvStatus("error");
      setCsvError("That file doesn't have any data rows below the header.");
      return;
    }

    const [header, ...body] = rows.map((r) => r.map((c) => String(c)));
    const mapping = detectHistoryColumns(header);

    if (mapping.exercise == null || mapping.date == null) {
      setCsvStatus("error");
      setCsvError(
        "Couldn't find both a Date column and an Exercise column — make sure your file has one of each and try again."
      );
      return;
    }

    setCsvNotice(null);
    setCsvBatchId(null);
    setCsvSkipped([]);
    const { rows: parsed, skipped, units } = parseHistoryRows(body, mapping, { headerUnit: headerUnitOf(header, mapping), chosenUnit: csvUnit, canFlag: viewerIsCoach });
    setCsvSkipped(skipped);
    // A file that mixes pounds and kilograms is imported with the odd rows marked unclear, and only a coach can write that mark: an athlete's own upload of such a file is stopped.
    if (units.mixed && !viewerIsCoach) {
      setCsvStatus("error");
      setCsvError("This file mixes pounds and kilograms. Ask your coach to import it, or make every weight use one unit.");
      return;
    }
    if (parsed.length === 0) {
      setCsvStatus("error");
      setCsvError("No usable rows found — every row needs a date, an exercise name, and a weight or rep count.");
      return;
    }
    if (parsed.some((r) => r.unclearReason) && !viewerIsCoach) {
      setCsvStatus("error");
      setCsvError("Some rows are marked unclear. Ask your coach to import this file.");
      return;
    }

    // A name that is only numbers, or carries sets and reps, means the Exercise column was read wrongly: nothing is imported.
    const badName = parsed.find((r) => exerciseNameProblem(r.exerciseName));
    if (badName) {
      setCsvStatus("error");
      setCsvError(`${NUMERIC_NAMES_MESSAGE} One of the names read was "${badName.exerciseName}".`);
      return;
    }

    setCsvRows(parsed);
    setCsvStatus("reviewing");
  }

  async function handleCsvConfirm() {
    setCsvStatus("importing");
    const supabase = createBrowserClient();
    const result = await importHistoryRows(supabase, { athleteId, groupId, rows: csvRows, batchId: csvBatchId ?? undefined });
    setCsvBatchId(result.batchId);
    if (result.error) {
      setCsvStatus("error");
      setCsvError(result.error);
      return;
    }
    if (result.importedCount > 0) await settleImportedHistory(supabase, groupId, athleteId);
    await refreshEntries();
    window.dispatchEvent(new Event("history-entries-changed"));
    if (result.failedRows.length > 0) {
      // Never "done" when some did not save: say how many did, which dates did not, and keep the file open on just those rows.
      setCsvRows(result.failedRows);
      setCsvNotice(`${result.importedCount} of ${result.totalRows} saved. These dates did not save: ${result.failedDates.join(", ")}. Press Import again to try only those; what was saved is not repeated.`);
      setCsvStatus("reviewing");
      return;
    }
    setCsvNotice(null);
    setCsvRows([]);
    setCsvSkipped([]);
    setCsvBatchId(null);
    setCsvStatus("idle");
  }

  // ---- Review / delete ------------------------------------------------
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(sessionId: string) {
    setDeletingId(sessionId);
    const supabase = createBrowserClient();
    await deleteHistoricalSession(supabase, sessionId);
    await recomputeTrainingMaxes(supabase, athleteId);
    setDeletingId(null);
    await refreshEntries();
  }

  const [undoingBatch, setUndoingBatch] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  // The imports still in the list, newest first, each with how many workouts it made. Taking one back removes exactly those workouts.
  const importBatches = (() => {
    const byBatch = new Map<string, { id: string; count: number; newest: string }>();
    for (const e of entries ?? []) {
      if (!e.importBatchId) continue;
      const b = byBatch.get(e.importBatchId) ?? { id: e.importBatchId, count: 0, newest: e.date };
      b.count++;
      byBatch.set(e.importBatchId, b);
    }
    return Array.from(byBatch.values());
  })();

  async function handleUndoBatch(batch: { id: string; count: number }) {
    if (!(await confirmDialog({ message: `Undo this import? Its ${batch.count} workout${batch.count === 1 ? "" : "s"} will be removed. Anything logged live or typed in is not touched.`, confirmLabel: "Undo import", destructive: true }))) return;
    setUndoingBatch(batch.id);
    setUndoError(null);
    const supabase = createBrowserClient();
    const { error } = await undoImportBatch(supabase, athleteId, batch.id);
    if (error) setUndoError(error);
    else await recomputeTrainingMaxes(supabase, athleteId);
    setUndoingBatch(null);
    await refreshEntries();
    window.dispatchEvent(new Event("history-entries-changed"));
  }

  // The rows of the file that were not read, with why.
  const skippedList = csvSkipped.length > 0 && (
    <div className="mb-3">
      <p className="font-body text-xs text-rust mb-1">
        {csvSkipped.length} row{csvSkipped.length === 1 ? " was" : "s were"} not read. Fix {csvSkipped.length === 1 ? "it" : "them"} in the file and import again; nothing here is lost.
      </p>
      <div className="max-h-40 overflow-y-auto border border-steel/20">
        {csvSkipped.slice(0, 50).map((s) => (
          <p key={s.rowNumber} className="font-body text-xs text-steel px-2 py-1 border-b border-steel/10 last:border-b-0">
            Row {s.rowNumber}: {s.detail}
          </p>
        ))}
        {csvSkipped.length > 50 && <p className="font-body text-xs text-steel px-2 py-1">…and {csvSkipped.length - 50} more</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-8 max-w-2xl">
      {parts.quick !== false && (
      <div className="border border-steel/20 bg-surface/40 p-6">
        <h3 className="font-display uppercase text-sm tracking-wide mb-1">Quick entry</h3>
        <p className="font-body text-xs text-steel mb-4">
          Add one exercise from {viewerIsCoach ? "this client's" : "your"} training history — a PR, a recent max, or
          anything worth grounding the AI program builder in. Flagged as self-reported, not gym-verified.
        </p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="col-span-2">
            <ExerciseNameInput value={manualExercise} onChange={setManualExercise} suggestions={exerciseSuggestions} />
          </div>
          <input aria-label={quickUnit === "kg" ? "Weight (kg)" : "Weight (lbs)"}
            type="number"
            inputMode="decimal"
            placeholder={quickUnit === "kg" ? "Weight (kg)" : "Weight (lbs)"}
            value={manualWeight}
            onChange={(e) => setManualWeight(e.target.value)}
            className="h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <input aria-label="Reps"
            type="number"
            inputMode="numeric"
            placeholder="Reps"
            value={manualReps}
            onChange={(e) => setManualReps(e.target.value)}
            className="h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <input aria-label="RPE (optional)"
            type="number"
            inputMode="decimal"
            step="0.5"
            placeholder="RPE (optional)"
            value={manualRpe}
            onChange={(e) => setManualRpe(e.target.value)}
            className="h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <input aria-label="Date"
            type="date"
            value={manualDate}
            max={todayDateKey()}
            onChange={(e) => setManualDate(e.target.value)}
            className="h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </div>
        <div className="mb-3">
          <WeightUnitChoice value={quickUnit} onChange={setQuickUnit} />
        </div>
        {manualError && (
          <p className="font-body text-xs text-rust mb-2" role="alert">
            {manualError}
          </p>
        )}
        <button
          type="button"
          onClick={handleManualSubmit}
          disabled={!canSubmitManual || manualSaving}
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {manualSaving ? "Saving…" : "Add entry"}
        </button>
      </div>
      )}

      {parts.spreadsheet !== false && (
      <div className="border border-steel/20 bg-surface/40 p-6">
        <h3 className="font-display uppercase text-sm tracking-wide mb-1">Import a spreadsheet</h3>
        <p className="font-body text-xs text-steel mb-4">
          Upload a .csv or .xlsx file with Date, Exercise, Weight, and Reps columns (any order, RPE optional).
          Nothing is saved until you confirm.
        </p>
        {csvStatus === "idle" && (
          <div className="mb-3">
            <WeightUnitChoice value={csvUnit} onChange={setCsvUnit} />
          </div>
        )}
        {csvStatus === "idle" && (
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) handleCsvFile(file);
            }}
            className="font-body text-sm text-chalk"
          />
        )}
        {csvStatus === "error" && csvError && (
          <div>
            <p className="font-body text-xs text-rust mb-2" role="alert">
              {csvError}
            </p>
            {skippedList}
            <button
              type="button"
              onClick={() => setCsvStatus("idle")}
              className="font-body text-xs text-steel underline"
            >
              Try another file
            </button>
          </div>
        )}
        {csvStatus === "reviewing" && (
          <div>
            {csvNotice && (
              <p className="font-body text-sm text-rust mb-2" role="alert">
                {csvNotice}
              </p>
            )}
            <p className="font-body text-sm text-chalk mb-2">
              Ready to import {csvRows.length} entr{csvRows.length === 1 ? "y" : "ies"}.
            </p>
            {skippedList}
            <div className="max-h-48 overflow-y-auto border border-steel/20 mb-3">
              {csvRows.slice(0, 20).map((row, i) => (
                <p key={i} className="font-body text-xs text-steel px-2 py-1 border-b border-steel/10 last:border-b-0">
                  {row.date} — {row.exerciseName}
                  {row.weight != null ? ` — ${row.weight} lbs` : ""}
                  {row.reps != null ? ` × ${row.reps}` : ""}
                  {row.rpe != null ? ` @ RPE ${row.rpe}` : ""}
                  {row.unclearReason ? ` — kept as an unclear data point: ${row.unclearReason}` : ""}
                </p>
              ))}
              {csvRows.length > 20 && (
                <p className="font-body text-xs text-steel px-2 py-1">…and {csvRows.length - 20} more</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCsvConfirm}
                className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium"
              >
                Import {csvRows.length} entr{csvRows.length === 1 ? "y" : "ies"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCsvRows([]);
                  setCsvSkipped([]);
                  setCsvStatus("idle");
                }}
                className="font-body text-xs text-steel"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {csvStatus === "importing" && <p className="font-body text-xs text-steel">Importing…</p>}
      </div>
      )}

      {parts.entries !== false && (
      <div className="border border-steel/20 bg-surface/40 p-6">
        <h3 className="font-display uppercase text-sm tracking-wide mb-3">
          {viewerIsCoach ? "Entries logged so far" : "Your history so far"}
        </h3>
        {importBatches.length > 0 && (
          <div className="mb-4 space-y-1">
            {importBatches.map((b) => (
              <div key={b.id} className="flex items-center justify-between border border-steel/15 px-3 py-2">
                <p className="font-body text-xs text-steel">
                  A spreadsheet import: {b.count} workout{b.count === 1 ? "" : "s"}
                </p>
                <button
                  type="button"
                  onClick={() => handleUndoBatch(b)}
                  disabled={undoingBatch === b.id}
                  className="font-body text-xs text-rust disabled:opacity-40"
                >
                  {undoingBatch === b.id ? "Undoing…" : "Undo this import"}
                </button>
              </div>
            ))}
            {undoError && (
              <p className="font-body text-xs text-rust" role="alert">
                {undoError}
              </p>
            )}
          </div>
        )}
        {entries === null && <p className="font-body text-xs text-steel">Loading…</p>}
        {entries !== null && entries.length === 0 && (
          <p className="font-body text-xs text-steel">Nothing entered yet.</p>
        )}
        {entries !== null && entries.length > 0 && (
          <div className="space-y-3">
            {entries.map((group) => (
              <div key={group.sessionId} className="border border-steel/15 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="font-body text-xs text-steel uppercase tracking-wide">
                    {new Date(`${group.date}T00:00:00`).toLocaleDateString()}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleDelete(group.sessionId)}
                    disabled={deletingId === group.sessionId}
                    className="font-body text-xs text-rust disabled:opacity-40"
                  >
                    {deletingId === group.sessionId ? "Deleting…" : "Delete"}
                  </button>
                </div>
                {group.exercises.map((ex, i) => (
                  <p key={i} className="font-body text-sm text-chalk">
                    {ex.exerciseName}:{" "}
                    {ex.sets
                      .map((s) => `${s.weight != null ? `${s.weight} lbs` : ""}${s.reps != null ? ` × ${s.reps}` : ""}`)
                      .join(", ")}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
