"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { createBrowserClient } from "@/lib/supabase/client";
import { ExerciseNameInput } from "@/components/coach/exercise-name-input";
import { detectHistoryColumns, parseHistoryRows, type ParsedHistoryRow } from "@/lib/history-import-parser";
import {
  insertManualHistoryEntry,
  importHistoryRows,
  listHistoricalEntries,
  deleteHistoricalSession,
  type HistoricalEntryGroup,
} from "@/lib/exercise-history-import";

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
}: {
  athleteId: string;
  groupId: string;
  exerciseSuggestions: string[];
  viewerIsCoach: boolean;
}) {
  const [entries, setEntries] = useState<HistoricalEntryGroup[] | null>(null);

  async function refreshEntries() {
    const supabase = createBrowserClient();
    setEntries(await listHistoricalEntries(supabase, athleteId));
  }

  useEffect(() => {
    refreshEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId]);

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
    setManualSaving(true);
    setManualError(null);

    const supabase = createBrowserClient();
    const { error } = await insertManualHistoryEntry(supabase, {
      athleteId,
      groupId,
      exerciseName: manualExercise.trim(),
      weight: manualWeight.trim() ? parseFloat(manualWeight) : null,
      reps: manualReps.trim() ? parseInt(manualReps, 10) : null,
      rpe: manualRpe.trim() ? parseFloat(manualRpe) : null,
      date: manualDate,
    });

    setManualSaving(false);
    if (error) {
      setManualError(error);
      return;
    }

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
  const [csvSkippedCount, setCsvSkippedCount] = useState(0);

  async function handleCsvFile(file: File) {
    setCsvStatus("idle");
    setCsvError(null);

    const buffer = await file.arrayBuffer();
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

    const { rows: parsed, skippedCount } = parseHistoryRows(body, mapping);
    if (parsed.length === 0) {
      setCsvStatus("error");
      setCsvError("No usable rows found — every row needs a date, an exercise name, and a weight or rep count.");
      return;
    }

    setCsvRows(parsed);
    setCsvSkippedCount(skippedCount);
    setCsvStatus("reviewing");
  }

  async function handleCsvConfirm() {
    setCsvStatus("importing");
    const supabase = createBrowserClient();
    await importHistoryRows(supabase, { athleteId, groupId, rows: csvRows });
    setCsvRows([]);
    setCsvSkippedCount(0);
    setCsvStatus("idle");
    await refreshEntries();
  }

  // ---- Review / delete ------------------------------------------------
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(sessionId: string) {
    setDeletingId(sessionId);
    const supabase = createBrowserClient();
    await deleteHistoricalSession(supabase, sessionId);
    setDeletingId(null);
    await refreshEntries();
  }

  return (
    <div className="space-y-8 max-w-2xl">
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
          <input
            type="number"
            inputMode="decimal"
            placeholder="Weight (lbs)"
            value={manualWeight}
            onChange={(e) => setManualWeight(e.target.value)}
            className="h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <input
            type="number"
            inputMode="numeric"
            placeholder="Reps"
            value={manualReps}
            onChange={(e) => setManualReps(e.target.value)}
            className="h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            placeholder="RPE (optional)"
            value={manualRpe}
            onChange={(e) => setManualRpe(e.target.value)}
            className="h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <input
            type="date"
            value={manualDate}
            max={todayDateKey()}
            onChange={(e) => setManualDate(e.target.value)}
            className="h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
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

      <div className="border border-steel/20 bg-surface/40 p-6">
        <h3 className="font-display uppercase text-sm tracking-wide mb-1">Import a spreadsheet</h3>
        <p className="font-body text-xs text-steel mb-4">
          Upload a .csv or .xlsx file with Date, Exercise, Weight, and Reps columns (any order, RPE optional).
          Nothing is saved until you confirm.
        </p>
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
            <p className="font-body text-sm text-chalk mb-2">
              Ready to import {csvRows.length} entr{csvRows.length === 1 ? "y" : "ies"}
              {csvSkippedCount > 0 ? ` (${csvSkippedCount} row${csvSkippedCount === 1 ? "" : "s"} skipped)` : ""}.
            </p>
            <div className="max-h-48 overflow-y-auto border border-steel/20 mb-3">
              {csvRows.slice(0, 20).map((row, i) => (
                <p key={i} className="font-body text-xs text-steel px-2 py-1 border-b border-steel/10 last:border-b-0">
                  {row.date} — {row.exerciseName}
                  {row.weight != null ? ` — ${row.weight} lbs` : ""}
                  {row.reps != null ? ` × ${row.reps}` : ""}
                  {row.rpe != null ? ` @ RPE ${row.rpe}` : ""}
                </p>
              ))}
              {csvRows.length > 20 && (
                <p className="font-body text-xs text-steel/70 px-2 py-1">…and {csvRows.length - 20} more</p>
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

      <div className="border border-steel/20 bg-surface/40 p-6">
        <h3 className="font-display uppercase text-sm tracking-wide mb-3">
          {viewerIsCoach ? "Entries logged so far" : "Your history so far"}
        </h3>
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
                    className="font-body text-[11px] text-rust disabled:opacity-40"
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
    </div>
  );
}
