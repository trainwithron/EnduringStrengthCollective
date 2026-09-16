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
  // new exercise either way), is unambiguous and never held up. A fuzzy
  // match is a guess that can genuinely be wrong (two different exercises
  // sharing a word) — those pause here for the coach to look at instead
  // of silently landing in a real program, which is what the "nothing to
  // confirm" copy claimed but the old flow didn't actually do.
  function prepareImport(
    parsed: ParsedImportRow[],
    programName: string,
    description: string,
    sequencingNotes: string | null = null,
    injuryConsiderations: string | null = null,
    progressionRules?: GzclpProgressionRule[]
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
      sequencingNotes,
      injuryConsiderations,
      progressionRules,
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

    // Single-active-program rule, scoped correctly (same split as
    // lib/program-duplication.ts's own deactivate query): a personal
    // program only steps down this same client's other personal
    // programs; a shared program only steps down other shared ones —
    // never crosses that line in either direction.
    let deactivateQuery = supabase
      .from("programs")
      .update({ is_active: false })
      .eq("group_id", groupId)
      .neq("id", programRow.id);
    deactivateQuery = athleteId
      ? deactivateQuery.eq("athlete_id", athleteId)
      : deactivateQuery.is("athlete_id", null);
    await deactivateQuery;

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
      schedule: trainingDays && startDate ? { trainingDays, startDate } : null,
      // Only the accepted guesses are worth flagging in the "just so you
      // know" summary — an overridden one is now just a plain new
      // exercise, same as anything else that matched nothing.
      fuzzyMatches: fuzzyMatches
        .filter((f) => !f.useRaw)
        .map((f) => ({ rawName: f.rawName, matchedTo: f.matchedTo, score: f.score })),
      injuryConsiderations,
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
        data.injuryConsiderations ?? null
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
      <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-6">
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

      <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-6">
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

      <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-6">
        <p className="font-body text-sm text-steel mb-3">
          Or describe the program you want and AI will write a full draft — same review pipeline as
          above, and it prefers exercises already in your library. Nothing is created until you confirm.
        </p>
        <div className="mb-3 border border-steel/15 bg-graphite/60 p-3">
          <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1.5">
            For the best result, mention:
          </p>
          <ul className="font-body text-xs text-steel space-y-0.5 list-disc list-inside">
            <li>Duration and days per week (e.g. &ldquo;8 weeks, 4 days/week&rdquo;)</li>
            <li>Experience level (beginner / intermediate / advanced)</li>
            <li>Focus — specific lifts, a goal (strength, hypertrophy, conditioning), or a sport</li>
            <li>Anything to avoid (an injury, equipment you don&apos;t have)</li>
          </ul>
          <button
            type="button"
            onClick={() =>
              setAiPrompt(
                'An 8-week intermediate strength block, 4 days/week, upper/lower split, built around squat/bench/deadlift/overhead press. No dumbbells past 50 lbs available.'
              )
            }
            disabled={status === "working"}
            className="mt-2 font-body text-[11px] text-rust underline decoration-dotted disabled:opacity-40"
          >
            Use this example →
          </button>
        </div>
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

      {athleteId && dupTrainingMaxes.length > 0 && (
        <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-6">
          <p className="font-body text-sm text-steel mb-1">
            Or generate a Daily Undulating Periodization (DUP) block for{" "}
            <span className="text-chalk">{athleteName ?? "this client"}</span> — deterministic, no
            AI involved, computed straight from their current training maxes below.
          </p>
          <p className="font-body text-[11px] text-steel/70 mb-4">
            Every training day covers every lift you select, rotating through{" "}
            {DUP_WEEKLY_SCHEME.map((s) => `${s.label} (${s.reps} @ ~${Math.round(s.percentOfTrainingMax * 100)}%)`).join(
              " → "
            )}
            {" "}each week. A defensible default scheme, not the one official DUP — adjust freely
            after it&apos;s created.
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
                <span className="text-[11px] text-steel">({lift.trainingMax} lb training max)</span>
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
            Or generate a GZCLP-style tier block for{" "}
            <span className="text-chalk">{athleteName ?? "this client"}</span> — 4 main lifts, each
            playing a main (T1, auto-progressing 5x3+/6x2+/10x1+ off their real performance) and
            secondary (T2, fixed 3x10) role across a 4-day week.
          </p>
          {dupTrainingMaxes.length < 4 ? (
            <p className="font-body text-xs text-steel mt-3">
              Needs a real training max on record for 4 main lifts —{" "}
              {athleteName ?? "this client"} only has {dupTrainingMaxes.length} logged so far. Log a
              few real sets for the other lifts first.
            </p>
          ) : (
            <>
              <p className="font-body text-[11px] text-steel/70 mb-4">
                T1 starting weight (week 1 only — every week after is computed live from real logged
                performance, never precomputed) comes from{" "}
                <label className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={gzclpStartPercent}
                    onChange={(e) => setGzclpStartPercent(Math.max(50, Math.min(100, Number(e.target.value) || 85)))}
                    disabled={status === "working"}
                    className="w-12 bg-graphite border border-steel/30 text-chalk px-1 py-0.5 font-body text-[11px] focus:outline-none focus:border-rust disabled:opacity-40"
                  />
                  %
                </label>{" "}
                of their current training max — a defensible starting point, not the one official
                number; adjust before generating if you know better for this athlete.
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
                    <label className="flex items-center gap-1.5 font-body text-[11px] text-steel">
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
              <p className="font-body text-[11px] text-steel/70 mb-4">
                Lifts 1+2 pair together (each is the other&apos;s T2), same for lifts 3+4 — the
                standard squat/bench + press/deadlift split, whatever you actually name them.
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
