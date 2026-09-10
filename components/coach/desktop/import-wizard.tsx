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

type Status = "idle" | "working" | "reviewing" | "done" | "error";

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

interface PendingFuzzyMatch {
  key: string;
  rawName: string;
  matchedTo: string;
  score: number;
  trackedFields: TrackedField[];
  // Coach override: reject the guess, treat this exercise as its own new
  // entry (added under the raw typed name) instead of the guessed match.
  useRaw: boolean;
}

interface ImportSummary {
  programName: string;
  weekCount: number;
  matchedCount: number;
  createdExercises: string[];
  fuzzyMatches: { rawName: string; matchedTo: string; score: number }[];
}

// Everything needed to actually write the program to the database, once
// any fuzzy matches have been reviewed (or there were none to review).
interface PendingImport {
  parsed: ParsedImportRow[];
  programName: string;
  description: string;
  resolutions: Map<string, { exerciseName: string; trackedFields: TrackedField[] }>;
  autoNewExercises: string[]; // matched nothing at all — unambiguous, never gated
  fuzzyMatches: PendingFuzzyMatch[]; // may be empty
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
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [finalizing, setFinalizing] = useState(false);
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

    prepareImport(parsed, file.name.replace(/\.(csv|xlsx|xls)$/i, ""), `Imported from ${file.name}`);
  }

  // Pure — matches every exercise against the coach's real library and
  // learned aliases, but writes nothing to the database yet. An exact or
  // alias match, or a name that matched nothing at all (added as its own
  // new exercise either way), is unambiguous and never held up. A fuzzy
  // match is a guess that can genuinely be wrong (two different exercises
  // sharing a word) — those pause here for the coach to look at instead
  // of silently landing in a real program, which is what the "nothing to
  // confirm" copy claimed but the old flow didn't actually do.
  function prepareImport(parsed: ParsedImportRow[], programName: string, description: string) {
    setStatusLabel("Matching exercises…");

    const resolutions = new Map<string, { exerciseName: string; trackedFields: TrackedField[] }>();
    const autoNewExercises: string[] = [];
    const fuzzyMatches: PendingFuzzyMatch[] = [];

    const uniqueExercises = new Map<string, string>(); // normalized -> raw display
    for (const row of parsed) {
      const key = normalizeName(row.exerciseName);
      if (!uniqueExercises.has(key)) uniqueExercises.set(key, row.exerciseName);
    }

    for (const [key, rawDisplay] of uniqueExercises) {
      const match = matchExercise(rawDisplay, initialLibrary, initialAliases);
      const usesTime = parsed.some(
        (r) => normalizeName(r.exerciseName) === key && r.timeSeconds != null
      );
      const trackedFields: TrackedField[] = usesTime
        ? [...DEFAULT_TRACKED_FIELDS, "time"]
        : DEFAULT_TRACKED_FIELDS;

      if (match.exerciseName) {
        resolutions.set(key, { exerciseName: match.exerciseName, trackedFields });
        if (match.confidence === "fuzzy" || match.confidence === "alias") {
          fuzzyMatches.push({
            key,
            rawName: rawDisplay,
            matchedTo: match.exerciseName,
            score: match.score,
            trackedFields,
            useRaw: false,
          });
        }
        continue;
      }

      // No match anywhere — not a guess, just "this is new." Nothing
      // ambiguous to review; it's added under its own typed name either
      // way, so this never gates on confirmation.
      resolutions.set(key, { exerciseName: rawDisplay.trim(), trackedFields });
      autoNewExercises.push(rawDisplay.trim());
    }

    const pendingImport: PendingImport = {
      parsed,
      programName,
      description,
      resolutions,
      autoNewExercises,
      fuzzyMatches,
    };

    if (fuzzyMatches.length === 0) {
      finalizeImport(pendingImport);
    } else {
      // Deliberately leaves processingRef true through the review step —
      // it's the same single-submission guard as handleFile/
      // handleAiPhotoUpload, just extended to cover "Create program"
      // too, so a fast double-click there can't fire two imports.
      // Cleared on Cancel below, or at the end of finalizeImport.
      setPending(pendingImport);
      setStatus("reviewing");
    }
  }

  function toggleFuzzyOverride(key: string, useRaw: boolean) {
    setPending((prev) =>
      prev
        ? { ...prev, fuzzyMatches: prev.fuzzyMatches.map((f) => (f.key === key ? { ...f, useRaw } : f)) }
        : prev
    );
  }

  // The actual database writes — only ever runs once the coach has seen
  // (or there were none to see) every fuzzy match. Applies any override
  // from the review step: a match marked "treat as new" gets its
  // resolution swapped to the raw typed name and is added to the library
  // as its own exercise instead of aliased to the guess.
  async function finalizeImport(importData: PendingImport) {
    if (finalizing) return;
    setFinalizing(true);
    setStatus("working");
    setStatusLabel("Creating program…");
    processingRef.current = true;

    const supabase = createBrowserClient();
    const { parsed, programName, description, fuzzyMatches, autoNewExercises } = importData;
    const resolutions = new Map(importData.resolutions);

    const createdExercises: string[] = [...autoNewExercises];
    const newAliases: { rawName: string; exerciseName: string }[] = [];

    for (const f of fuzzyMatches) {
      if (f.useRaw) {
        const trimmed = f.rawName.trim();
        resolutions.set(f.key, { exerciseName: trimmed, trackedFields: f.trackedFields });
        createdExercises.push(trimmed);
      } else {
        newAliases.push({ rawName: f.key, exerciseName: f.matchedTo });
      }
    }

    for (const name of createdExercises) {
      await supabase.from("exercise_library").insert({ created_by: coachId, name, category: null });
    }
    for (const alias of newAliases) {
      await supabase
        .from("exercise_aliases")
        .upsert(
          { coach_id: coachId, raw_name: alias.rawName, exercise_name: alias.exerciseName },
          { onConflict: "coach_id,raw_name" }
        );
    }

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
      setFinalizing(false);
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
      matchedCount: resolutions.size - createdExercises.length,
      createdExercises,
      // Only the accepted guesses are worth flagging in the "just so you
      // know" summary — an overridden one is now just a plain new
      // exercise, same as anything else that matched nothing.
      fuzzyMatches: fuzzyMatches
        .filter((f) => !f.useRaw)
        .map((f) => ({ rawName: f.rawName, matchedTo: f.matchedTo, score: f.score })),
    });
    setDoneHref(`/groups/${groupId}/programs/${programRow.id}`);
    setPending(null);
    setStatus("done");
    processingRef.current = false;
    setFinalizing(false);
    router.refresh();
  }

  const [aiPrompt, setAiPrompt] = useState("");

  async function handleAiGenerate() {
    if (processingRef.current || !aiPrompt.trim()) return;
    processingRef.current = true;
    setStatus("working");
    setError(null);
    setStatusLabel("Writing a program with AI…");

    try {
      const res = await fetch("/api/ai/generate-program", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt, groupId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setError(data.error ?? "Couldn't generate a program — try again.");
        processingRef.current = false;
        return;
      }

      prepareImport(data.rows, data.programName, `AI-generated from: "${aiPrompt.trim()}"`);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't generate a program — try again.");
      processingRef.current = false;
    }
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

      prepareImport(data.rows, file.name.replace(/\.\w+$/, ""), `Imported from a photo (AI) — ${file.name}`);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't read that image — try again.");
      processingRef.current = false;
    }
  }

  if (status === "reviewing" && pending) {
    return (
      <div className="border border-yellow-500/40 bg-surface/60 p-6 max-w-2xl">
        <h3 className="font-display uppercase text-sm tracking-wide mb-2">
          Double-check {pending.fuzzyMatches.length} guessed exercise
          {pending.fuzzyMatches.length === 1 ? "" : "es"}
        </h3>
        <p className="font-body text-sm text-steel mb-4">
          These weren&apos;t an exact match to anything in your library — we guessed the closest
          one, but a guess can be wrong (two different exercises can share a word). Nothing has
          been created yet.
        </p>
        <div className="space-y-3 mb-5">
          {pending.fuzzyMatches.map((f) => (
            <div key={f.key} className="border border-steel/20 p-3">
              <p className="font-body text-sm">
                &ldquo;{f.rawName}&rdquo; <span className="text-[11px] text-steel">({Math.round(f.score * 100)}% match)</span>
              </p>
              <label className="flex items-center gap-2 mt-2 font-body text-xs text-chalk">
                <input
                  type="radio"
                  name={`fuzzy-${f.key}`}
                  checked={!f.useRaw}
                  onChange={() => toggleFuzzyOverride(f.key, false)}
                />
                Use the match: <span className="text-steel">{f.matchedTo}</span>
              </label>
              <label className="flex items-center gap-2 mt-1 font-body text-xs text-chalk">
                <input
                  type="radio"
                  name={`fuzzy-${f.key}`}
                  checked={f.useRaw}
                  onChange={() => toggleFuzzyOverride(f.key, true)}
                />
                Add &ldquo;{f.rawName}&rdquo; as its own new exercise instead
              </label>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => finalizeImport(pending)}
            disabled={finalizing}
            className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            {finalizing ? "Creating…" : "Create program"}
          </button>
          <button
            type="button"
            onClick={() => {
              processingRef.current = false;
              setPending(null);
              setStatus("idle");
            }}
            className="font-body text-xs text-steel"
          >
            Cancel import
          </button>
        </div>
      </div>
    );
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
              guessed and confirmed:
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
          We&apos;ll match exercises against your library automatically and add anything new.
          Nothing is created until you&apos;ve confirmed it — the only case that skips a review
          step is when every exercise matched exactly or was clearly new, with nothing guessed.
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
          <div className="mt-3">
            <p className="font-body text-xs text-steel flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-rust animate-pulse" />
              {statusLabel}
            </p>
            {statusLabel === "Writing a program with AI…" && (
              <p className="font-body text-[11px] text-steel/70 mt-1">
                Longer programs can take up to a minute — hang tight, this hasn&apos;t stalled.
              </p>
            )}
          </div>
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

      <div className="border border-steel/20 bg-surface/40 p-6">
        <p className="font-body text-sm text-steel mb-4">
          Or describe the program you want and AI will write a full draft — same review pipeline as
          above, and it prefers exercises already in your library. Nothing is created until you confirm.
        </p>
        <textarea
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          disabled={status === "working"}
          rows={3}
          placeholder='e.g. "12-week strength block, 4 days/week, squat/bench/deadlift focus, intermediate client"'
          className="w-full bg-graphite border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none disabled:opacity-40"
        />
        <button
          type="button"
          onClick={handleAiGenerate}
          disabled={status === "working" || !aiPrompt.trim()}
          className="mt-3 h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          Generate program
        </button>
      </div>
    </div>
  );
}
