"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import { createBrowserClient } from "@/lib/supabase/client";

// xlsx's own auto-load for its optional codepage-table module only fires
// in a plain Node `require` context, not in a bundled browser build — so
// $cptable stays undefined here and xlsx logs "Codepage tables are not
// loaded" on every read() call that passes a `codepage` option, even
// though codepage 65001 (UTF-8, the only one this app ever uses) already
// has its own built-in decode path and doesn't actually need the table.
// Loading it explicitly is the officially supported fix for a bundled
// environment — it only silences the benign warning, it changes nothing
// about how files are decoded.
XLSX.set_cptable(cptable);
import {
  detectColumns,
  parseImportRows,
  mergeIdenticalSetRows,
  groupIntoWeeks,
  parseRestSeconds,
  type ParsedImportRow,
} from "@/lib/workout-import-parser";
import {
  matchExercise,
  normalizeName,
  type LibraryExercise,
  type AliasEntry,
} from "@/lib/exercise-matching";
import { DEFAULT_TRACKED_FIELDS, type TrackedField } from "@/lib/exercise-fields";
import { defaultTrainingDaysForCount } from "@/lib/program-schedule";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { detectTrainingIntent } from "@/lib/training-intent";
import { hasFlaggedMusculoskeletalConcern } from "@/lib/athlete-injury-flag";
import { generateDupProgram, generateDupSelfUpdatingProgram, DUP_WEEKLY_SCHEME } from "@/lib/dup-generator";
import { generateGzclpProgram, type GzclpLiftInput, type GzclpProgressionRule } from "@/lib/gzclp-generator";
import { AiOutputWrongButton } from "@/components/coach/ai-output-wrong-button";
import { AiUsageMeter } from "@/components/coach/ai-usage-meter";
import { detectImportKind } from "@/lib/import-input-kind";
import { buildImportPrompt } from "@/lib/import-prompt";

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
  schedule: { trainingDays: number[]; startDate: string } | null;
  // Only set for an AI-generated program built for a specific flagged
  // client (injury_pain_science_research_and_ai_gap_sept15.md) — the
  // model's own required self-disclosure of how it handled the flagged
  // concern, surfaced here so the coach's review is actually informed by
  // it before they commit, not buried in a field nobody looks at.
  injuryConsiderations: string | null;
  // ai_output_foolproofing_and_quality_assurance_idea.md — only true for
  // the two genuinely AI-sourced paths, same flag as PendingImport's own
  // isAiSourced. Gates whether the "done" screen offers a refund — a
  // human-authored import or a deterministic DUP/GZCLP shell was never
  // credit-metered in the first place, nothing to refund.
  isAiSourced: boolean;
  creditCharged: boolean;
  programId: string;
  // Days, exercises or sets that failed to save. Non-zero means the program
  // is incomplete and the coach must check it, not trust it.
  failedWrites: number;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Everything needed to actually write the program to the database, once
// any fuzzy matches have been reviewed (or there were none to review).
interface PendingImport {
  parsed: ParsedImportRow[];
  programName: string;
  description: string;
  resolutions: Map<string, { exerciseName: string; trackedFields: TrackedField[] }>;
  autoNewExercises: string[]; // matched nothing at all — unambiguous, never gated
  fuzzyMatches: PendingFuzzyMatch[]; // may be empty
  // Only set for an AI-generated program (ai_program_builder_
  // conversational_learning_idea.md) — the model's own real reasoning
  // captured at generation time, saved so the "Ask the AI why" chat has
  // something grounded to answer from later, instead of reconstructing
  // (and risking confabulating) a reason after the fact.
  sequencingNotes: string | null;
  injuryConsiderations: string | null;
  // Only set for a GZCLP-generated program — inserted into
  // exercise_progressions right after the program row exists, so weeks
  // 2+ compute dynamically instead of needing weeks of precomputed
  // weights (dup_gzclp_build_spec_sept15.md §1.3).
  progressionRules?: GzclpProgressionRule[];
  // ai_output_validation_audit_findings_sept30.md — true only for the two
  // genuinely LLM-sourced paths (plain-English generate, AI photo read).
  // A human-authored spreadsheet import or a deterministic DUP/GZCLP
  // shell is never flagged, since there's no model output to second-
  // guess. Gates the auto-finalize skip below: an AI-sourced import must
  // always stop for a real look before it commits, even when every
  // exercise happened to match exactly (see prepareImport's own comment).
  isAiSourced: boolean;
  // True only when a program-generation credit was actually charged for this import (the plain-English writer). Reading a picture, PDF or pasted text charges none, so the
  // "This was wrong" refund is offered only when this is true.
  creditCharged: boolean;
  // ai_output_validation_audit_findings_sept30.md — generate-program's
  // own post-generation checks, surfaced here so the coach sees them on
  // the review screen before confirming. Never gates/auto-rejects.
  libraryFlags: { exerciseName: string; flaggedReason: string }[];
  adherenceCheck: {
    equipmentLimits: string | null;
    exclusions: string | null;
    requestedSplit: string | null;
    violations: string[];
  } | null;
}

export function ImportWizard({
  coachId,
  groupId,
  athleteId,
  athleteName,
  initialLibrary,
  initialAliases,
  initialAiPrompt,
  autoGenerate,
}: {
  coachId: string;
  groupId: string;
  // Personal-program mode (injury_pain_science_research_and_ai_gap_
  // sept15.md) — set only when reached from a specific client's
  // profile via "Build with AI for this client." Undefined for the
  // plain group-level "New Program" flow, which is completely
  // unaffected by anything in this pass.
  athleteId?: string | null;
  athleteName?: string | null;
  initialLibrary: LibraryExercise[];
  initialAliases: AliasEntry[];
  // the_spot_dropdown_widget_redesign_sept16.md — the Spot's mobile NL
  // builder composes a richer prompt (free text + progression rule +
  // program length + methodology) before handing off to this exact same
  // AI-generate pipeline, full screen. Both undefined for every existing
  // caller (New Program / Import pages), which render identically to
  // before.
  initialAiPrompt?: string;
  autoGenerate?: boolean;
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

  // One-time flagged-injury notice (injury_pain_science_research_and_
  // ai_gap_sept15.md) — Ron's own real constraint: most clients report
  // *some* PAR-Q+ history, so re-showing this on every generation would
  // become noise fast (same discipline as the 3-item coach-briefing
  // cap). Shown once per (coach, athlete), dismissible, persisted —
  // never re-appears once acknowledged, even after this component
  // remounts on a later visit.
  const [showInjuryBanner, setShowInjuryBanner] = useState(false);
  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const [{ data: intakeRow }, { data: ackRow }] = await Promise.all([
        supabase.from("client_intake").select("par_q_answers").eq("athlete_id", athleteId).maybeSingle(),
        supabase
          .from("athlete_injury_flag_acknowledgements")
          .select("athlete_id")
          .eq("coach_id", coachId)
          .eq("athlete_id", athleteId)
          .maybeSingle(),
      ]);
      const flagged = hasFlaggedMusculoskeletalConcern((intakeRow?.par_q_answers as any[]) ?? []);
      if (!cancelled) setShowInjuryBanner(flagged && !ackRow);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [athleteId, coachId]);

  async function dismissInjuryBanner() {
    setShowInjuryBanner(false);
    if (!athleteId) return;
    const supabase = createBrowserClient();
    await supabase
      .from("athlete_injury_flag_acknowledgements")
      .upsert({ coach_id: coachId, athlete_id: athleteId }, { onConflict: "coach_id,athlete_id" });
  }

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

    // Self-heals a real AI-extraction mistake — a uniform set scheme
    // like "3x8" occasionally comes back as three separate Sets=1 rows
    // instead of one Sets=3 row. Never merges a genuine ramp set (each
    // row's own target values must be identical) or across a day
    // boundary — see mergeIdenticalSetRows' own doc comment.
    const parsed = mergeIdenticalSetRows(parseImportRows(body, mapping));
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
  // new exercise either way), is unambiguous and never held up for a
  // human-authored import. A fuzzy match is a guess that can genuinely
  // be wrong (two different exercises sharing a word) — those pause here
  // for the coach to look at regardless of source.
  //
  // ai_output_validation_audit_findings_sept30.md — a real correctness
  // bug lived here: an AI-sourced generation (plain-English or photo)
  // that happened to match every exercise exactly skipped straight to
  // finalizeImport with zero human review, silently going live as the
  // athlete's active program (deactivating whatever they were already
  // on) the moment the request resolved. `isAiSourced` closes that path —
  // an AI-sourced import always stops for a real look, never just on
  // whether a guess needs arbitrating.
  function prepareImport(
    parsed: ParsedImportRow[],
    programName: string,
    description: string,
    sequencingNotes: string | null = null,
    injuryConsiderations: string | null = null,
    progressionRules?: GzclpProgressionRule[],
    isAiSourced: boolean = false,
    libraryFlags: { exerciseName: string; flaggedReason: string }[] = [],
    adherenceCheck: PendingImport["adherenceCheck"] = null,
    creditCharged: boolean = false
  ) {
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
      const usesRest = parsed.some(
        (r) => normalizeName(r.exerciseName) === key && parseRestSeconds(r.rest) != null
      );
      // Timed work with no reps anywhere (a plank for 60 seconds) tracks Time instead of reps.
      const usesReps = parsed.some((r) => normalizeName(r.exerciseName) === key && r.reps != null && r.reps !== "");
      const trackedFields: TrackedField[] = [
        ...(usesTime && !usesReps ? DEFAULT_TRACKED_FIELDS.filter((f) => f !== "reps") : DEFAULT_TRACKED_FIELDS),
        ...(usesTime ? (["time"] as TrackedField[]) : []),
        ...(usesRest ? (["rest"] as TrackedField[]) : []),
      ];

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
      sequencingNotes,
      injuryConsiderations,
      progressionRules,
      isAiSourced,
      creditCharged,
      libraryFlags,
      adherenceCheck,
    };

    if (fuzzyMatches.length === 0 && !isAiSourced) {
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
    const { parsed, programName, description, fuzzyMatches, autoNewExercises, sequencingNotes, injuryConsiderations } =
      importData;
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

    const weeks = groupIntoWeeks(parsed);

    // Auto-schedule so an AI/import-generated program actually resolves
    // as "today's workout" and shows on the calendar immediately, the
    // same as a manually-created program does by defaulting to active —
    // without this it silently sat inactive with no start date, invisible
    // until a coach happened to find and configure it by hand. The
    // training-day spread is a real guess (there's no coach preference to
    // read here), so it's surfaced plainly in the success summary below
    // rather than applied silently.
    const daysPerWeek = weeks[0]?.days.length ?? 0;
    const trainingDays = defaultTrainingDaysForCount(daysPerWeek);
    const timezone = await getGroupCoachTimezone(supabase, groupId);
    const startDate = trainingDays ? dateKeyInZone(timezone) : null;

    const { data: programRow, error: programError } = await supabase
      .from("programs")
      .insert({
        group_id: groupId,
        created_by: coachId,
        // Personal-program mode (injury_pain_science_research_and_ai_
        // gap_sept15.md) — null for the plain group-level flow,
        // completely unchanged from before this pass.
        athlete_id: athleteId ?? null,
        name: programName || "Imported Program",
        description,
        is_active: true,
        start_date: startDate,
        training_days: trainingDays,
        visibility_window: "day",
        ai_sequencing_notes: sequencingNotes,
        training_intent: detectTrainingIntent(programName || "Imported Program"),
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

    // dup_gzclp_build_spec_sept15.md §1.3 point 2 — a thin post-write
    // step alongside finalizeImport rather than a new pipeline: only
    // present for a GZCLP-generated program, so every other import path
    // (CSV/photo/AI-generate/DUP) is completely unaffected.
    if (importData.progressionRules && importData.progressionRules.length > 0) {
      await supabase.from("exercise_progressions").insert(
        importData.progressionRules.map((rule) => ({
          program_id: programRow.id,
          group_id: groupId,
          exercise_name: rule.exerciseName,
          model: rule.model,
          config: rule.config,
          tier_label: rule.tierLabel,
          created_by: coachId,
        }))
      );
    }

    // Finalizing an import never deactivates the client's other programs:
    // several programs can be active at once, activation is per program.

    let failedWrites = 0;
    for (const week of weeks) {
      for (let dayIndex = 0; dayIndex < week.days.length; dayIndex++) {
        const day = week.days[dayIndex];
        const { data: workoutRow, error: workoutError } = await supabase
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
        if (!workoutRow || workoutError) {
          failedWrites += Math.max(1, day.exercises.length);
          continue;
        }

        for (let exIndex = 0; exIndex < day.exercises.length; exIndex++) {
          const ex = day.exercises[exIndex];
          const resolution = resolutions.get(normalizeName(ex.exerciseName));
          if (!resolution) continue;

          const { data: exerciseRow, error: exerciseError } = await supabase
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
          if (!exerciseRow || exerciseError) {
            failedWrites += 1;
            continue;
          }

          const setsPayload = Array.from({ length: Math.max(1, ex.sets) }, (_, setOrder) => ({
            group_workout_exercise_id: exerciseRow.id,
            set_order: setOrder,
            target_reps: ex.reps,
            target_weight: ex.weight,
            target_rpe: ex.rpe,
            target_time_seconds: ex.timeSeconds,
            target_rest_seconds: ex.restSeconds ?? null,
          }));

          const { error: setsError } = await supabase.from("group_workout_exercise_sets").insert(setsPayload);
          if (setsError) failedWrites += 1;
        }
      }
    }

    setSummary({
      programName: programName || "Imported Program",
      weekCount: weeks.length,
      matchedCount: resolutions.size - createdExercises.length,
      createdExercises,
      schedule: trainingDays && startDate ? { trainingDays, startDate } : null,
      // Only the accepted guesses are worth flagging in the "just so you
      // know" summary — an overridden one is now just a plain new
      // exercise, same as anything else that matched nothing.
      fuzzyMatches: fuzzyMatches
        .filter((f) => !f.useRaw)
        .map((f) => ({ rawName: f.rawName, matchedTo: f.matchedTo, score: f.score })),
      injuryConsiderations,
      isAiSourced: importData.isAiSourced,
      creditCharged: importData.creditCharged,
      programId: programRow.id,
      failedWrites,
    });
    setDoneHref(`/groups/${groupId}/programs/${programRow.id}`);
    setPending(null);
    setStatus("done");
    processingRef.current = false;
    setFinalizing(false);
    router.refresh();
  }

  // dup_gzclp_build_spec_sept15.md — DUP Path A, deterministic (no LLM),
  // so this only needs the athlete's own persisted training maxes, not a
  // server round trip. Only offered in personal-program mode (a real
  // athleteId) since the % scheme needs one specific athlete's numbers
  // to compute from — never invented, same "only use a listed number"
  // discipline the AI-generate path already follows.
  const [dupTrainingMaxes, setDupTrainingMaxes] = useState<
    { exerciseName: string; trainingMax: number }[]
  >([]);
  const [dupSelected, setDupSelected] = useState<Set<string>>(new Set());
  const [dupWeeks, setDupWeeks] = useState(4);
  // dup_gzclp_build_spec_sept15.md §2.3 — Path A (default) bakes real
  // weights into the shell from today's training max, a snapshot that
  // needs a manual regenerate to pick up a later PR. Path B never bakes
  // a weight in at all; every occurrence reads the athlete's CURRENT
  // training max live, forever, at the cost of needing a training-max
  // row to exist before the very first session (Path A only needs it at
  // generation time).
  const [dupSelfUpdating, setDupSelfUpdating] = useState(false);

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("athlete_training_maxes")
        .select("exercise_name, estimated_max")
        .eq("athlete_id", athleteId)
        .order("exercise_name");
      if (cancelled) return;
      const rows = (data ?? []).map((r) => ({
        exerciseName: r.exercise_name as string,
        trainingMax: r.estimated_max as number,
      }));
      setDupTrainingMaxes(rows);
      setDupSelected(new Set(rows.map((r) => r.exerciseName)));
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  function toggleDupLift(name: string) {
    setDupSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleDupGenerate() {
    if (processingRef.current) return;
    const lifts = dupTrainingMaxes.filter((l) => dupSelected.has(l.exerciseName));
    if (lifts.length === 0) return;
    processingRef.current = true;
    setStatus("working");
    setError(null);
    setStatusLabel("Building the DUP block…");

    if (dupSelfUpdating) {
      const { rows, progressionRules } = generateDupSelfUpdatingProgram({ lifts, weeksToGenerate: dupWeeks });
      prepareImport(
        rows,
        `${dupWeeks}-Week DUP Block (self-updating)`,
        `Daily Undulating Periodization, ${dupWeeks} weeks — every session's weight is computed live from ${athleteName ?? "this client"}'s current training max (${lifts.map((l) => l.exerciseName).join(", ")}), self-updating on new PRs, never a fixed snapshot.`,
        null,
        null,
        progressionRules
      );
      return;
    }

    const rows = generateDupProgram({ lifts, weeksToGenerate: dupWeeks });
    prepareImport(
      rows,
      `${dupWeeks}-Week DUP Block`,
      `Daily Undulating Periodization, ${dupWeeks} weeks — generated from ${athleteName ?? "this client"}'s current training maxes (${lifts.map((l) => l.exerciseName).join(", ")}).`
    );
  }

  // GZCLP — same real training-max data source as the DUP panel above,
  // just a different consumption shape: 4 named slots in the canonical
  // T1/T2 pairing order (dup_gzclp_build_spec_sept15.md §1.3 point 5).
  const [gzclpLiftNames, setGzclpLiftNames] = useState<[string, string, string, string]>(["", "", "", ""]);
  const [gzclpT2Weights, setGzclpT2Weights] = useState<[string, string, string, string]>(["", "", "", ""]);
  // §1.5 point 3's flagged real risk: estimated_max is a theoretical
  // true max, real GZCLP starts more conservatively — ~85% is a common
  // practical convention, presented here as an editable default, never
  // silently asserted as fact.
  const [gzclpStartPercent, setGzclpStartPercent] = useState(85);
  const [gzclpWeeks, setGzclpWeeks] = useState(12);

  function handleGzclpGenerate() {
    if (processingRef.current) return;
    if (gzclpLiftNames.some((n) => !n) || gzclpT2Weights.some((w) => !w || Number(w) <= 0)) return;

    const lifts = gzclpLiftNames.map((name, i) => {
      const tm = dupTrainingMaxes.find((l) => l.exerciseName === name);
      const t1StartingWeight = tm ? Math.round((tm.trainingMax * gzclpStartPercent) / 100 / 5) * 5 : 0;
      return { exerciseName: name, t1StartingWeight, t2StartingWeight: Number(gzclpT2Weights[i]) };
    }) as [GzclpLiftInput, GzclpLiftInput, GzclpLiftInput, GzclpLiftInput];

    processingRef.current = true;
    setStatus("working");
    setError(null);
    setStatusLabel("Building the GZCLP shell…");
    const { rows, progressionRules } = generateGzclpProgram({ lifts, weeksToGenerate: gzclpWeeks });
    prepareImport(
      rows,
      `${gzclpWeeks}-Week GZCLP`,
      `GZCLP-style tier programming, ${gzclpWeeks} weeks — Week 1 T1 weights set at ${gzclpStartPercent}% of ${athleteName ?? "this client"}'s current training max; T1 auto-progresses through the real 5x3+/6x2+/10x1+ stage cascade from week 2 on.`,
      null,
      null,
      progressionRules
    );
  }

  const [aiPrompt, setAiPrompt] = useState(initialAiPrompt ?? "");
  const [dragOver, setDragOver] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const boxKind = detectImportKind({ text: aiPrompt });
  const autoGenerateFiredRef = useRef(false);

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
        body: JSON.stringify({ prompt: aiPrompt, groupId, athleteId: athleteId ?? undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setError(data.error ?? "Couldn't generate a program — try again.");
        processingRef.current = false;
        return;
      }

      prepareImport(
        data.rows,
        data.programName,
        `AI-generated from: "${aiPrompt.trim()}"`,
        data.sequencingNotes ?? null,
        data.injuryConsiderations ?? null,
        undefined,
        true,
        data.libraryFlags ?? [],
        data.adherenceCheck ?? null,
        true
      );
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't generate a program — try again.");
      processingRef.current = false;
    }
  }

  // The Spot's mobile NL builder composes its prompt and wants generation
  // to start the instant this component mounts, not require a second tap
  // on a button the coach never sees (they already tapped "Generate" once
  // on the compact sheet). The ref guards the real double-invoke React
  // 18 Strict Mode runs every effect through in dev.
  useEffect(() => {
    if (autoGenerate && initialAiPrompt && !autoGenerateFiredRef.current) {
      autoGenerateFiredRef.current = true;
      handleAiGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Everything the AI reader can take (a photo, a PDF, pasted text) goes through one call to /api/ai/parse-workout and lands on the same review screen as every other path.
  async function readWithAi(body: Record<string, unknown>, workingLabel: string, programName: string, sourceNote: string, fallbackError: string) {
    if (processingRef.current) return;
    processingRef.current = true;
    setStatus("working");
    setError(null);
    setStatusLabel(workingLabel);

    try {
      const res = await fetch("/api/ai/parse-workout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setError(data.error ?? fallbackError);
        processingRef.current = false;
        return;
      }

      prepareImport(data.rows, programName, sourceNote, null, null, undefined, true);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : fallbackError);
      processingRef.current = false;
    }
  }

  async function handleAiPhotoUpload(file: File) {
    if (processingRef.current) return;
    const base64 = await fileToBase64(file);
    await readWithAi({ imageBase64: base64, mediaType: file.type }, "Reading the picture with AI…", file.name.replace(/\.\w+$/, ""), `Imported from a picture (AI) — ${file.name}`, "Couldn't read that picture — try again.");
  }

  async function handleAiPdfUpload(file: File) {
    if (processingRef.current) return;
    const base64 = await fileToBase64(file);
    await readWithAi({ pdfBase64: base64 }, "Reading the PDF…", file.name.replace(/\.\w+$/, ""), `Imported from a PDF (AI) — ${file.name}`, "Couldn't read that PDF — try again.");
  }

  async function handleAiTextImport(text: string, programName: string, sourceNote: string) {
    await readWithAi({ text }, "Reading the program with AI…", programName, sourceNote, "Couldn't read that text — try again.");
  }

  // One drop zone, one chooser, one paste: the app decides what it is. A spreadsheet is read free in the browser; a PDF, picture or text file goes to the AI reader.
  async function handleBoxFile(file: File) {
    if (processingRef.current) return;
    const decision = detectImportKind({ fileName: file.name, mimeType: file.type, sizeBytes: file.size });
    if (decision.kind === "unsupported") {
      setStatus("error");
      setError(decision.message ?? "That file can't be read here.");
      return;
    }
    if (decision.kind === "spreadsheet") return handleFile(file);
    if (decision.kind === "image") return handleAiPhotoUpload(file);
    if (decision.kind === "pdf") return handleAiPdfUpload(file);
    // a .txt or .md file: its content is the program
    const text = (await file.text()).trim();
    const checked = detectImportKind({ text });
    if (checked.kind === "empty") {
      setStatus("error");
      setError("That file is empty.");
      return;
    }
    if (checked.kind === "unsupported") {
      setStatus("error");
      setError(checked.message ?? "That text is too long to read at once.");
      return;
    }
    await handleAiTextImport(text, file.name.replace(/\.\w+$/, ""), `Imported from a text file (AI) — ${file.name}`);
  }

  // The button under the box: a plain description is written into a program, pasted program text is read as it is.
  function handleBoxSubmit() {
    if (processingRef.current) return;
    const decision = detectImportKind({ text: aiPrompt });
    if (decision.kind === "empty") return;
    if (decision.kind === "unsupported") {
      setStatus("error");
      setError(decision.message ?? "That text can't be used.");
      return;
    }
    if (decision.kind === "pasted_program") {
      void handleAiTextImport(aiPrompt.trim(), "Pasted program", "Imported from pasted text (AI)");
      return;
    }
    void handleAiGenerate();
  }

  async function copyImportPrompt() {
    try {
      await navigator.clipboard.writeText(buildImportPrompt());
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      setPromptCopied(false);
    }
  }

  if (status === "reviewing" && pending) {
    // ai_output_validation_audit_findings_sept30.md — an AI-sourced
    // import (isAiSourced) now always lands here, even with zero fuzzy
    // matches to arbitrate, so this needs to show real content in that
    // case rather than an empty "0 guessed exercises" heading. Computed
    // lazily (only when there's actually something to show) since
    // groupIntoWeeks isn't free on a long program.
    const previewWeeks = pending.isAiSourced ? groupIntoWeeks(pending.parsed) : [];
    return (
      <div className="border border-yellow-500/40 bg-surface/60 p-6 max-w-2xl">
        <h3 className="font-display uppercase text-sm tracking-wide mb-2">
          {pending.fuzzyMatches.length > 0
            ? `Double-check ${pending.fuzzyMatches.length} guessed exercise${pending.fuzzyMatches.length === 1 ? "" : "s"}`
            : "Review before creating"}
        </h3>
        <p className="font-body text-sm text-steel mb-4">
          {pending.fuzzyMatches.length > 0
            ? "These weren't an exact match to anything in your library — we guessed the closest one, but a guess can be wrong (two different exercises can share a word). Nothing has been created yet."
            : "AI-generated content always gets a real look before it's created — this will become the athlete's active program and replace whatever they're currently on. Nothing has been created yet."}
        </p>
        {pending.isAiSourced && pending.injuryConsiderations && (
          <div className="mb-4 border border-rust/40 bg-rust/5 p-3">
            <p className="font-body text-xs text-rust font-medium mb-1">
              How this handled {athleteName ?? "this client"}&apos;s flagged health/injury concern:
            </p>
            <p className="font-body text-xs text-chalk leading-snug">{pending.injuryConsiderations}</p>
          </div>
        )}
        {pending.isAiSourced && pending.adherenceCheck && pending.adherenceCheck.violations.length > 0 && (
          <div className="mb-4 border border-yellow-500/40 bg-yellow-500/5 p-3">
            <p className="font-body text-xs text-chalk font-medium mb-1.5">
              The AI flagged possible issues with its own output — double-check these:
            </p>
            <ul className="font-body text-xs text-steel space-y-1 list-disc list-inside">
              {pending.adherenceCheck.violations.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          </div>
        )}
        {pending.isAiSourced && pending.libraryFlags.length > 0 && (
          <div className="mb-4 border border-yellow-500/40 bg-yellow-500/5 p-3">
            <p className="font-body text-xs text-chalk font-medium mb-1.5">
              {pending.libraryFlags.length} exercise{pending.libraryFlags.length === 1 ? "" : "s"} weren&apos;t in your
              library:
            </p>
            <ul className="font-body text-xs text-steel space-y-1">
              {pending.libraryFlags.map((f, i) => (
                <li key={i}>
                  <span className="text-chalk">{f.exerciseName}</span> — {f.flaggedReason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {previewWeeks.length > 0 && (
          <div className="mb-5 max-h-80 overflow-y-auto border border-steel/20">
            {previewWeeks.map((week) => (
              <div key={week.weekLabel} className="border-b border-steel/15 last:border-b-0">
                <p className="font-display text-xs uppercase tracking-wide text-steel px-3 pt-2.5">
                  {week.weekLabel}
                </p>
                {week.days.map((day, i) => (
                  <div key={i} className="px-3 py-2">
                    <p className="font-body text-xs font-medium text-chalk mb-1">{day.dayLabel}</p>
                    <ul className="font-body text-xs text-steel space-y-0.5">
                      {day.exercises.map((ex, j) => (
                        <li key={j}>
                          {ex.exerciseName} — {ex.sets}×{ex.reps ?? (ex.timeSeconds != null ? `${ex.timeSeconds}s` : "?")}
                          {ex.weight != null ? ` @ ${ex.weight}` : ""}
                          {ex.reps != null && ex.timeSeconds != null ? ` (${ex.timeSeconds}s)` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="space-y-3 mb-5">
          {pending.fuzzyMatches.map((f) => (
            <div key={f.key} className="border border-steel/20 p-3">
              <p className="font-body text-sm">
                &ldquo;{f.rawName}&rdquo; <span className="text-xs text-steel">({Math.round(f.score * 100)}% match)</span>
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
        {summary.failedWrites > 0 && (
          <div className="mb-4 border border-rust/60 bg-rust/10 p-3" role="alert">
            <p className="font-body text-xs text-chalk leading-snug">
              {summary.failedWrites} {summary.failedWrites === 1 ? "part" : "parts"} of this program did not save,
              so some days or exercises are missing. Open the program and check every week before assigning it.
            </p>
          </div>
        )}
        {summary.injuryConsiderations && (
          <div className="mb-4 border border-rust/40 bg-rust/5 p-3">
            <p className="font-body text-xs text-rust font-medium mb-1">
              How this handled {athleteName ?? "this client"}&apos;s flagged health/injury concern:
            </p>
            <p className="font-body text-xs text-chalk leading-snug">{summary.injuryConsiderations}</p>
          </div>
        )}
        {summary.schedule ? (
          <p className="font-body text-xs text-steel mb-4">
            Set as the active program, starting today and training{" "}
            {summary.schedule.trainingDays.map((d) => WEEKDAY_LABELS[d]).join("/")} — it&apos;ll
            show up on the calendar and as today&apos;s workout right away. Not the right days?
            Change them anytime from this program&apos;s schedule settings.
          </p>
        ) : (
          <p className="font-body text-xs text-steel mb-4">
            Set as the active program — set a start date and training days from this
            program&apos;s schedule settings to have it show up on the calendar.
          </p>
        )}
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
                  <span className="text-xs">({Math.round(f.score * 100)}% match)</span>
                </p>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-3 mb-4">
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
        {summary.creditCharged && (
          <AiOutputWrongButton action="program_generation" referenceId={summary.programId} />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      {showInjuryBanner && (
        <div className="border border-rust/40 bg-rust/5 p-4 flex items-start justify-between gap-4">
          <p className="font-body text-sm text-rust">
            <span className="font-medium">{athleteName ?? "This client"} has a flagged health/injury
            concern</span> on their intake screening — review anything generated for them closely.
          </p>
          <button
            type="button"
            onClick={dismissInjuryBanner}
            className="shrink-0 font-body text-xs text-rust underline underline-offset-2"
          >
            Got it
          </button>
        </div>
      )}
      <div
        className={`border rounded-token-lg p-6 ${dragOver ? "border-rust bg-rust/5 border-dashed" : "border-steel/20 bg-surface/40"}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (status !== "working") setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && status !== "working") handleBoxFile(file);
        }}
      >
        <label htmlFor="build-with-ai-box" className="block font-display uppercase text-sm tracking-wide mb-1">
          Describe a program, or drop one in
        </label>
        <p className="font-body text-xs text-steel mb-3">
          Type what you want, paste a program, or drop a spreadsheet, PDF, photo or screenshot. You review everything before anything is created.
        </p>
        <textarea
          id="build-with-ai-box"
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onPaste={(e) => {
            const file = e.clipboardData?.files?.[0];
            if (file && status !== "working") {
              e.preventDefault();
              handleBoxFile(file);
            }
          }}
          disabled={status === "working"}
          rows={5}
          placeholder={'e.g. "12-week strength block, 4 days/week, squat/bench/deadlift focus, intermediate client". Or paste a program here.'}
          className="w-full bg-graphite border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust resize-y disabled:opacity-40"
        />
        <p className="font-body text-xs text-steel mt-1.5">Helpful to mention: weeks, days per week, experience level, focus, and anything to avoid.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleBoxSubmit}
            disabled={status === "working" || boxKind.kind === "empty"}
            className="h-11 sm:h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            {boxKind.kind === "pasted_program" ? "Read this program" : "Generate program"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.xlsx,.xls,.pdf,.txt,.md,image/*"
            disabled={status === "working"}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) handleBoxFile(file);
            }}
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose a program file"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={status === "working"}
            className="h-11 sm:h-9 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40"
          >
            Choose a file
          </button>
          <span className="font-body text-xs text-steel">Spreadsheets are read free. PDFs, photos and text use AI.</span>
        </div>
        <div className="mt-2">
          <AiUsageMeter groupId={groupId} focus="program" compact />
        </div>
        {status === "working" && (
          <div className="mt-3">
            <p className="font-body text-xs text-steel flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-rust animate-pulse" />
              {statusLabel}
            </p>
            {statusLabel === "Writing a program with AI…" && (
              <p className="font-body text-xs text-steel mt-1">Longer programs can take up to a minute — hang tight, this hasn&apos;t stalled.</p>
            )}
          </div>
        )}
        {status === "error" && error && (
          <p className="font-body text-xs text-rust mt-3" role="alert">
            {error}
          </p>
        )}
        <details className="mt-4">
          <summary className="font-body text-xs text-steel cursor-pointer">Prefer to use your own AI? Copy this prompt</summary>
          <div className="mt-2 space-y-2">
            <p className="font-body text-xs text-steel">Give it to your AI along with your program. Drop the CSV it gives you back into the box above, which is read free.</p>
            <button
              type="button"
              onClick={copyImportPrompt}
              className="h-11 sm:h-9 px-4 border border-steel/40 text-chalk font-body text-sm"
            >
              {promptCopied ? "Copied" : "Copy prompt"}
            </button>
          </div>
        </details>
      </div>

      {athleteId && dupTrainingMaxes.length > 0 && (
        <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-6">
          <p className="font-body text-sm text-steel mb-1">
            Or a DUP block for <span className="text-chalk">{athleteName ?? "this client"}</span> — no AI, built from their current training maxes.
          </p>
          <p className="font-body text-xs text-steel mb-4">
            Each day rotates through{" "}
            {DUP_WEEKLY_SCHEME.map((s) => `${s.label} (${s.reps} @ ~${Math.round(s.percentOfTrainingMax * 100)}%)`).join(" → ")}.
          </p>
          <div className="space-y-1.5 mb-4">
            {dupTrainingMaxes.map((lift) => (
              <label key={lift.exerciseName} className="flex items-center gap-2 font-body text-sm text-chalk">
                <input
                  type="checkbox"
                  checked={dupSelected.has(lift.exerciseName)}
                  onChange={() => toggleDupLift(lift.exerciseName)}
                />
                {lift.exerciseName}{" "}
                <span className="text-xs text-steel">({lift.trainingMax} lb training max)</span>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 font-body text-xs text-steel mb-3">
            Weeks
            <input
              type="number"
              min={1}
              max={16}
              value={dupWeeks}
              onChange={(e) => setDupWeeks(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
              disabled={status === "working"}
              className="w-16 bg-graphite border border-steel/30 text-chalk px-2 py-1 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-40"
            />
          </label>
          <label className="flex items-start gap-2 font-body text-xs text-steel mb-4">
            <input
              type="checkbox"
              checked={dupSelfUpdating}
              onChange={(e) => setDupSelfUpdating(e.target.checked)}
              disabled={status === "working"}
              className="mt-0.5"
            />
            <span>
              <span className="text-chalk">Make this self-updating</span> — never bakes in a
              weight; every session reads {athleteName ?? "this client"}&apos;s CURRENT training
              max live, forever, instead of a snapshot from today that needs a manual regenerate
              to reflect a later PR.
            </span>
          </label>
          <button
            type="button"
            onClick={handleDupGenerate}
            disabled={status === "working" || dupSelected.size === 0}
            className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            Generate DUP block
          </button>
        </div>
      )}

      {athleteId && (
        <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-6">
          <p className="font-body text-sm text-steel mb-1">
            Or a GZCLP-style block for <span className="text-chalk">{athleteName ?? "this client"}</span> — 4 main lifts, 4 days a week, no AI.
          </p>
          {dupTrainingMaxes.length < 4 ? (
            <p className="font-body text-xs text-steel mt-3">
              Needs a real training max on record for 4 main lifts —{" "}
              {athleteName ?? "this client"} only has {dupTrainingMaxes.length} logged so far. Log a
              few real sets for the other lifts first.
            </p>
          ) : (
            <>
              <p className="font-body text-xs text-steel mb-4">
                T1 starts at{" "}
                <label className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={gzclpStartPercent}
                    onChange={(e) => setGzclpStartPercent(Math.max(50, Math.min(100, Number(e.target.value) || 85)))}
                    disabled={status === "working"}
                    className="w-12 bg-graphite border border-steel/30 text-chalk px-1 py-0.5 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-40"
                  />
                  %
                </label>{" "}
                of their training max.
              </p>
              <div className="space-y-2 mb-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={gzclpLiftNames[i]}
                      disabled={status === "working"}
                      onChange={(e) =>
                        setGzclpLiftNames((prev) => {
                          const next = [...prev] as typeof prev;
                          next[i] = e.target.value;
                          return next;
                        })
                      }
                      className="bg-graphite border border-steel/30 text-chalk px-2 py-1.5 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-40 flex-1"
                    >
                      <option value="">Select a lift…</option>
                      {dupTrainingMaxes.map((l) => (
                        <option key={l.exerciseName} value={l.exerciseName}>
                          {l.exerciseName} ({l.trainingMax} lb training max)
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 font-body text-xs text-steel">
                      T2 start
                      <input
                        type="number"
                        min={0}
                        value={gzclpT2Weights[i]}
                        disabled={status === "working"}
                        onChange={(e) =>
                          setGzclpT2Weights((prev) => {
                            const next = [...prev] as typeof prev;
                            next[i] = e.target.value;
                            return next;
                          })
                        }
                        placeholder="lb"
                        className="w-16 bg-graphite border border-steel/30 text-chalk px-2 py-1 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-40"
                      />
                    </label>
                  </div>
                ))}
              </div>
              <p className="font-body text-xs text-steel mb-4">
                Lifts 1 and 2 pair as each other&apos;s T2, as do lifts 3 and 4.
              </p>
              <label className="flex items-center gap-2 font-body text-xs text-steel mb-4">
                Weeks
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={gzclpWeeks}
                  onChange={(e) => setGzclpWeeks(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
                  disabled={status === "working"}
                  className="w-16 bg-graphite border border-steel/30 text-chalk px-2 py-1 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-40"
                />
              </label>
              <button
                type="button"
                onClick={handleGzclpGenerate}
                disabled={
                  status === "working" ||
                  gzclpLiftNames.some((n) => !n) ||
                  gzclpT2Weights.some((w) => !w || Number(w) <= 0) ||
                  new Set(gzclpLiftNames).size !== 4
                }
                className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
              >
                Generate GZCLP shell
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
