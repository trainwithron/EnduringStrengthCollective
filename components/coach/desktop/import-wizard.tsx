"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  detectColumns,
  parseImportRows,
  groupIntoWeeks,
  type ParsedImportRow,
} from "@/lib/workout-import-parser";
import {
  matchExercise,
  normalizeName,
  type LibraryExercise,
  type AliasEntry,
} from "@/lib/exercise-matching";
import { DEFAULT_TRACKED_FIELDS, type TrackedField } from "@/lib/exercise-fields";

type Status = "idle" | "working" | "done" | "error";

// Strips the "data:image/jpeg;base64," prefix FileReader adds — Claude's
// API wants the raw base64 payload with the media type sent separately.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface FuzzyMatch {
  rawName: string;
  matchedTo: string;
  score: number;
}

interface ImportSummary {
  programName: string;
  weekCount: number;
  matchedCount: number;
  createdExercises: string[];
  fuzzyMatches: FuzzyMatch[];
}

export function ImportWizard({
  coachId,
  groupId,
  initialLibrary,
  initialAliases,
}: {
  coachId: string;
  groupId: string;
  initialLibrary: LibraryExercise[];
  initialAliases: AliasEntry[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [statusLabel, setStatusLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [doneHref, setDoneHref] = useState<string | null>(null);
  // A ref, not state — guards against a file input somehow firing its
  // change handler more than once for the same upload (observed during
  // dev with hot-reload; state alone isn't synchronous enough to close
  // that window before a second call slips through and builds a second,
  // duplicate program from the same file).
  const processingRef = useRef(false);

  async function handleFile(file: File) {
    if (processingRef.current) return;
    processingRef.current = true;
    setStatus("working");
    setError(null);
    setStatusLabel("Reading file…");

    const buffer = await file.arrayBuffer();
    // codepage 65001 = UTF-8 — without it, xlsx defaults to a legacy
    // codepage for raw CSV bytes and mangles any non-ASCII character
    // (accents, °, etc.) into mojibake.
    const workbook = XLSX.read(buffer, { type: "array", codepage: 65001 });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });

    if (rows.length < 2) {
      setStatus("error");
      setError("That file doesn't have any data rows below the header.");
      processingRef.current = false;
      return;
    }

    const [header, ...body] = rows.map((r) => r.map((c) => String(c)));
    const mapping = detectColumns(header);

    if (mapping.exercise == null) {
      setStatus("error");
      setError(
        "Couldn't find an Exercise column in this file — make sure one column is clearly headed \"Exercise\" (or similar) and try again."
      );
      processingRef.current = false;
      return;
    }

    const parsed = parseImportRows(body, mapping);
    if (parsed.length === 0) {
      setStatus("error");
      setError("No rows had a value in the Exercise column.");
      processingRef.current = false;
      return;
    }

    await commitParsedRows(parsed, file.name.replace(/\.(csv|xlsx|xls)$/i, ""), `Imported from ${file.name}`);
  }

  // Shared by the spreadsheet path above and the AI photo/PDF path below —
  // once either one has produced ParsedImportRow[], everything downstream
  // (fuzzy exercise matching, library growth, program/workout creation) is
  // identical regardless of where the rows came from.
  async function commitParsedRows(parsed: ParsedImportRow[], programName: string, description: string) {
    setStatusLabel("Matching exercises…");

    const library = [...initialLibrary];
    const aliases = [...initialAliases];
    const resolutions = new Map<
      string,
      { exerciseName: string; trackedFields: TrackedField[] }
    >();
    const newAliases: { rawName: string; exerciseName: string }[] = [];
    const createdExercises: string[] = [];
    const fuzzyMatches: FuzzyMatch[] = [];

    const supabase = createBrowserClient();

    const uniqueExercises = new Map<string, string>(); // normalized -> raw display
    for (const row of parsed) {
      const key = normalizeName(row.exerciseName);
      if (!uniqueExercises.has(key)) uniqueExercises.set(key, row.exerciseName);
    }

    for (const [key, rawDisplay] of uniqueExercises) {
      const match = matchExercise(rawDisplay, library, aliases);
      const usesTime = parsed.some(
        (r) => normalizeName(r.exerciseName) === key && r.timeSeconds != null
      );
      const trackedFields: TrackedField[] = usesTime
        ? [...DEFAULT_TRACKED_FIELDS, "time"]
        : DEFAULT_TRACKED_FIELDS;

      if (match.exerciseName) {
        resolutions.set(key, { exerciseName: match.exerciseName, trackedFields });
        if (match.confidence !== "exact") {
          newAliases.push({ rawName: key, exerciseName: match.exerciseName });
        }
        // Fuzzy (and alias) matches are a guess, not a certainty — flag
        // them in the summary so a wrong one (two different exercises
        // that happen to share a word) is at least visible, even though
        // nothing here blocks on it.
        if (match.confidence === "fuzzy" || match.confidence === "alias") {
          fuzzyMatches.push({ rawName: rawDisplay, matchedTo: match.exerciseName, score: match.score });
        }
        continue;
      }

      // No match anywhere — silently add it to the coach's library under
      // its own name rather than blocking on a manual review step. It's
      // now searchable/reusable like anything else; the coach can tag a
      // movement pattern/tier for it later from the Exercise Library if
      // they want to, but nothing here waits on that.
      const trimmed = rawDisplay.trim();
      await supabase.from("exercise_library").insert({
        created_by: coachId,
        name: trimmed,
        category: null,
      });
      library.push({ name: trimmed });
      resolutions.set(key, { exerciseName: trimmed, trackedFields });
      createdExercises.push(trimmed);
    }

    for (const alias of newAliases) {
      await supabase
        .from("exercise_aliases")
        .upsert(
          { coach_id: coachId, raw_name: alias.rawName, exercise_name: alias.exerciseName },
          { onConflict: "coach_id,raw_name" }
        );
    }

    setStatusLabel("Creating program…");

    const { data: programRow, error: programError } = await supabase
      .from("programs")
      .insert({
        group_id: groupId,
        created_by: coachId,
        name: programName || "Imported Program",
        description,
        is_active: false,
      })
      .select("id")
      .single();

    if (programError || !programRow) {
      setStatus("error");
      setError("Couldn't create the program — try again.");
      processingRef.current = false;
      return;
    }

    const weeks = groupIntoWeeks(parsed);

    for (const week of weeks) {
      for (let dayIndex = 0; dayIndex < week.days.length; dayIndex++) {
        const day = week.days[dayIndex];
        const { data: workoutRow } = await supabase
          .from("workouts")
          .insert({
            program_id: programRow.id,
            group_id: groupId,
            title: day.dayLabel,
            week_number: week.weekNumber,
            day_index: dayIndex + 1,
          })
          .select("id")
          .single();
        if (!workoutRow) continue;

        for (let exIndex = 0; exIndex < day.exercises.length; exIndex++) {
          const ex = day.exercises[exIndex];
          const resolution = resolutions.get(normalizeName(ex.exerciseName));
          if (!resolution) continue;

          const { data: exerciseRow } = await supabase
            .from("group_workout_exercises")
            .insert({
              workout_id: workoutRow.id,
              group_id: groupId,
              exercise_name: resolution.exerciseName,
              exercise_order: exIndex,
              tracked_fields: resolution.trackedFields,
            })
            .select("id")
            .single();
          if (!exerciseRow) continue;

          const setsPayload = Array.from({ length: Math.max(1, ex.sets) }, (_, setOrder) => ({
            group_workout_exercise_id: exerciseRow.id,
            set_order: setOrder,
            target_reps: ex.reps,
            target_weight: ex.weight,
            target_rpe: ex.rpe,
            target_time_seconds: ex.timeSeconds,
          }));

          await supabase.from("group_workout_exercise_sets").insert(setsPayload);
        }
      }
    }

    setSummary({
      programName: programName || "Imported Program",
      weekCount: weeks.length,
      matchedCount: uniqueExercises.size - createdExercises.length,
      createdExercises,
      fuzzyMatches,
    });
    setDoneHref(`/groups/${groupId}/programs/${programRow.id}`);
    setStatus("done");
    processingRef.current = false;
    router.refresh();
  }

  async function handleAiPhotoUpload(file: File) {
    if (processingRef.current) return;
    processingRef.current = true;
    setStatus("working");
    setError(null);
    setStatusLabel("Reading the photo with AI…");

    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/ai/parse-workout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: file.type }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setError(data.error ?? "Couldn't read that image — try again.");
        processingRef.current = false;
        return;
      }

      await commitParsedRows(
        data.rows,
        file.name.replace(/\.\w+$/, ""),
        `Imported from a photo (AI) — ${file.name}`
      );
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't read that image — try again.");
      processingRef.current = false;
    }
  }

  if (status === "done" && summary && doneHref) {
    return (
      <div className="border border-positive/40 bg-surface/60 p-6 max-w-lg">
        <h3 className="font-display uppercase text-sm tracking-wide mb-2">Program generated</h3>
        <p className="font-body text-sm text-steel mb-2">
          &ldquo;{summary.programName}&rdquo; was created across {summary.weekCount} week
          {summary.weekCount === 1 ? "" : "s"} — {summary.matchedCount} exercise
          {summary.matchedCount === 1 ? "" : "s"} matched your existing library.
        </p>
        {summary.createdExercises.length > 0 && (
          <p className="font-body text-xs text-steel mb-4">
            {summary.createdExercises.length} new exercise
            {summary.createdExercises.length === 1 ? "" : "s"} added to your library:{" "}
            {summary.createdExercises.join(", ")}. Tag a movement pattern/tier for these later from
            the Exercise Library if you want them included in bulk-by-class edits.
          </p>
        )}
        {summary.fuzzyMatches.length > 0 && (
          <div className="mb-4 border border-yellow-500/40 bg-yellow-500/5 p-3">
            <p className="font-body text-xs text-chalk font-medium mb-1.5">
              {summary.fuzzyMatches.length} exercise{summary.fuzzyMatches.length === 1 ? " was" : "s were"}{" "}
              guessed, not certain — worth a quick check:
            </p>
            <div className="space-y-1">
              {summary.fuzzyMatches.map((f, i) => (
                <p key={i} className="font-body text-xs text-steel">
                  &ldquo;{f.rawName}&rdquo; &rarr; <span className="text-chalk">{f.matchedTo}</span>{" "}
                  <span className="text-[11px]">({Math.round(f.score * 100)}% match)</span>
                </p>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <a
            href={doneHref}
            className="inline-flex items-center h-9 px-4 bg-rust text-graphite font-body text-sm font-medium"
          >
            Open program &rarr;
          </a>
          <button
            type="button"
            onClick={() => {
              setStatus("idle");
              setSummary(null);
              setDoneHref(null);
            }}
            className="font-body text-xs text-steel"
          >
            Import another file
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="border border-steel/20 bg-surface/40 p-6">
        <p className="font-body text-sm text-steel mb-4">
          Upload a spreadsheet export (.csv or .xlsx) — columns and headers can be in any order.
          We'll match exercises against your library automatically, add anything new, and build the
          program. Nothing to confirm on your end unless the file itself can't be read.
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          disabled={status === "working"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="font-body text-sm text-chalk disabled:opacity-40"
        />
        {status === "working" && (
          <p className="font-body text-xs text-steel mt-3">{statusLabel}</p>
        )}
        {status === "error" && error && (
          <p className="font-body text-xs text-rust mt-3" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="border border-steel/20 bg-surface/40 p-6">
        <p className="font-body text-sm text-steel mb-4">
          Or upload a photo or screenshot of a program — from another app, a spreadsheet, or a
          handwritten sheet — and AI will read it into the same review pipeline as above. Convert a
          PDF page to an image first (a screenshot works fine).
        </p>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          disabled={status === "working"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handleAiPhotoUpload(file);
          }}
          className="font-body text-sm text-chalk disabled:opacity-40"
        />
      </div>
    </div>
  );
}
