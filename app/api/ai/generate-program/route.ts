import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError, AiTruncatedError } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import type { ParsedImportRow } from "@/lib/workout-import-parser";
import { hasFlaggedMusculoskeletalConcern } from "@/lib/athlete-injury-flag";
import { checkAndSpendCoachCredits, canRunAiAction } from "@/lib/coach-credits";
import { matchExercise, matchTopN, type LibraryExercise } from "@/lib/exercise-matching";

// Generates a full draft program from a coach's plain-English description
// — "the bones" of an AI program builder, deliberately built as a
// generation source for the EXISTING import review pipeline
// (ImportWizard.prepareImport) rather than a parallel program-creation
// path. That pipeline already does the real work this needs: matching
// generated exercise names against the coach's real library, flagging
// ambiguous guesses for review, and only writing to the database once
// the coach confirms. Nothing here is "trained" on the coach's data in
// the machine-learning sense — it's the same grounded-generation
// approach as the AI photo importer, just fed the coach's real exercise
// list as context so it prefers reusing what they already have.
const INJURY_JSON_FIELD = `,
  "injuryConsiderations": string  // REQUIRED whenever an athlete injury/health context is given below.
                                    // State specifically what you avoided, substituted, or modified
                                    // because of it, OR — if the context gave you a flag but no real
                                    // detail (e.g. just "a PAR-Q+ musculoskeletal flag, no further
                                    // detail from the coach") — say plainly that there wasn't enough
                                    // detail to target specific exclusions, and that the coach should
                                    // review this program closely with that in mind. Never fabricate a
                                    // specific injury detail that wasn't given to you.`;

// Grounded in a real, RCT-backed clinical model (Silbernagel et al. 2007)
// rather than an invented rule — the one concrete, programmable piece of
// evidence from the injury/pain-science research pass. Deliberately does
// NOT assert "avoid spinal flexion under load" or any other single
// exercise/movement as categorically unsafe — that specific claim is
// genuinely contested in the literature (JOSPT 2020 systematic review
// found no clear causal link between lumbar flexion and back-pain risk),
// so this system prompt never bakes it in as settled fact.
const PAIN_MONITORING_GUIDANCE = `If you reference how the client should judge pain/discomfort during or after a
flagged movement, ground it in this real clinical model rather than inventing your own rule: mild discomfort up to
about 5 out of 10 during or shortly after training is generally an acceptable signal to keep going, PROVIDED it
settles back to baseline by the next morning and does not get worse week over week. Sharp, sudden, or worsening
pain is never acceptable — that always means stop and the coach should follow up. Do not assert that any single
movement pattern (e.g. spinal flexion) is categorically unsafe — that specific claim is genuinely contested in the
current literature, not settled fact.`;

const ADHERENCE_JSON_FIELD = `,
  "adherenceCheck": {
    "equipmentLimits": string | null,  // any equipment constraint you detected in the description, or null if none
    "exclusions": string | null,       // any movement/exercise exclusion you detected, or null if none stated
    "requestedSplit": string | null,   // the training split you detected being asked for (e.g. "upper/lower"), or null if none specified
    "violations": string[]             // HONEST, SELF-CRITICAL: list any way your OWN rows below might still
                                          // violate an equipment limit, exclusion, or the requested split (e.g.
                                          // "Row 'Barbell Bench Press' may violate the stated 'no barbell' limit").
                                          // Empty array if you're confident there are none. This is reviewed by
                                          // the coach before anything is created — do not hide a real doubt here.
  }`;

function buildSystemPrompt(hasInjuryContext: boolean): string {
  return `You are an experienced strength & conditioning coach writing a training program
from a plain-English description. Respond with ONLY a JSON object shaped exactly like this — no markdown
fences, no explanation:

{
  "programName": string,        // short, e.g. "12-Week Strength Block"
  "sequencingNotes": string,    // 1-3 sentences on the real methodology reasons behind how you
                                  // ordered/sequenced this program (e.g. why certain work comes early
                                  // vs. late in a session, how weeks progress) — this is saved and
                                  // shown back to the coach later if they ask "why did you do that",
                                  // so it must reflect your ACTUAL reasoning, not a generic summary${
                                    hasInjuryContext ? INJURY_JSON_FIELD : ""
                                  }${ADHERENCE_JSON_FIELD},
  "rows": [
    {
      "week": string,          // e.g. "Week 1"
      "day": string,           // e.g. "Day 1" — reuse the same day label across an exercise's day
      "exerciseName": string,  // prefer an EXACT name from the coach's exercise library below if a
                                 // suitable one exists; only invent a new name if nothing in the
                                 // library fits (e.g. a movement pattern they don't have yet)
      "sets": number,          // integer, minimum 1
      "reps": string | null,   // e.g. "8", "8-10", "AMRAP" — null only for pure time-based work
      "weight": number | null, // leave null unless the description gives you a real number/percentage
                                 // to compute from — either stated directly in the description (e.g.
                                 // "start at 70% of a 225 squat" -> 157), OR a percentage of a NAMED
                                 // athlete's real training max listed below (e.g. "5/3/1 for Sarah,
                                 // week 1" with Sarah's Back Squat max listed as 225 -> compute 65/75/85%
                                 // of 225 for that week's sets). Never invent a training-max number that
                                 // isn't either stated in the description or listed below.
      "rpe": number | null,
      "rest": string | null,
      "timeSeconds": number | null
    }
  ]
}

Rules:
- Build a real, coherent program matching the description's length, frequency, and focus. If the
  description doesn't specify a length, default to 4 weeks. If it doesn't specify days/week, default to
  the frequency that best fits the stated focus (3-4 for general strength, higher for hypertrophy splits).
- One row per exercise per day, not one row per set (a 3x8 exercise is ONE row with sets=3, reps="8").
- Vary the program sensibly week to week (progressive overload, or the specific progression scheme
  described) rather than repeating the exact same week verbatim.
- If this coach has standing preferences listed below (learned from past corrections), apply any whose
  stated condition matches this program — these come from a real coach explicitly correcting a past
  program, so treat them as real methodology requirements, not suggestions.
- Exercises you choose AUTONOMOUSLY as part of your own program design — i.e. not something the coach's
  description specifically named — must come ONLY from the coach's exercise library listed below, using the
  exact names given. Never invent an exercise name on your own.
  If the coach's own description explicitly names a specific exercise by name — even one not in the library —
  use it exactly as named anyway; that is a deliberate coach request, not something you're picking on your
  own, and it is handled separately on review.
- Pay real attention to any equipment limits, exclusions, or requested training split in the description, and
  self-report your own adherence honestly in adherenceCheck above — including any row you're not fully
  confident actually complies.${
    hasInjuryContext
      ? `
- This program is for a specific client with a flagged injury/health concern, given to you below. Treat it as
  a HARD CONSTRAINT, not optional context: avoid or substantially modify any exercise that could reasonably
  aggravate the stated area. When you must exclude something the description otherwise implies (e.g. an
  overhead-press-focused block for a shoulder concern), substitute a safer regression and say so in
  injuryConsiderations rather than silently dropping it. ${PAIN_MONITORING_GUIDANCE}`
      : ""
  }
- Respond with ONLY the JSON object described. No leading or trailing text.`;
}

function isValidRow(row: any): row is ParsedImportRow {
  return (
    row &&
    typeof row.week === "string" &&
    typeof row.day === "string" &&
    typeof row.exerciseName === "string" &&
    row.exerciseName.trim().length > 0 &&
    typeof row.sets === "number"
  );
}

// AI generation can take well over the platform default; without this the request is cut off mid-way.
export const maxDuration = 120;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "The AI program builder isn't available yet." },
      { status: 503 }
    );
  }

  const { prompt, groupId, athleteId } = await request.json();
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "Describe the program you want first." }, { status: 400 });
  }
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId." }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return NextResponse.json({ error: "Only coaches can generate programs." }, { status: 403 });
  }

  // Read-only pre-check so a coach fails fast before any expensive work:
  // this month's included generations, then credits (migration 0226/0227).
  // The real spend happens only on a genuine success below, never here.
  const canRun = await canRunAiAction(supabase, user.id, "program_generation");
  if (!canRun.ok) {
    return NextResponse.json({ error: canRun.error }, { status: 402 });
  }

  // Injury-awareness (injury_pain_science_research_and_ai_gap_sept15.md)
  // — real gap this closes: until now, nothing about a specific client's
  // stated injury/health history ever reached generation at all. Only
  // trusted when the athlete is actually a real athlete in this same
  // group (never take an arbitrary id at face value for a coach-only
  // action like this).
  let injuryContextText: string | null = null;
  if (typeof athleteId === "string" && athleteId) {
    const { data: athleteMembership } = await supabase
      .from("group_memberships")
      .select("role")
      .eq("group_id", groupId)
      .eq("profile_id", athleteId)
      .maybeSingle();
    if (athleteMembership?.role === "athlete") {
      const [{ data: intakeRow }, { data: noteRow }] = await Promise.all([
        supabase.from("client_intake").select("par_q_answers").eq("athlete_id", athleteId).maybeSingle(),
        supabase.from("athlete_notes").select("body").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle(),
      ]);
      const flagged = hasFlaggedMusculoskeletalConcern((intakeRow?.par_q_answers as any[]) ?? []);
      const noteText = noteRow?.body?.trim() || null;
      if (flagged || noteText) {
        injuryContextText =
          `This client has flagged a musculoskeletal/health concern on their intake screening` +
          (flagged ? " (PAR-Q+: yes to the bone/joint/soft-tissue question)" : "") +
          `.\n` +
          (noteText
            ? `The coach's own note about this client: "${noteText}"`
            : `No further detail was provided by the coach — treat this as a general caution, not a specific exclusion you can target.`);
      }
    }
  }
  const hasInjuryContext = injuryContextText !== null;

  // ai_output_validation_audit_findings_sept30.md's hard constraint: an
  // exercise the AI picks autonomously must be a real exercise in the
  // coach's library — never a hallucinated name. (A video requirement
  // was tried and dropped at Ron's direction: he's building out the
  // library's videos himself, so missing video is not a violation.) A
  // coach's own explicitly-named exercise is exempt (checked
  // post-generation below, not here).
  const { data: libraryRows } = await supabase
    .from("exercise_library")
    .select("name")
    .eq("created_by", user.id)
    .order("name")
    .limit(300);
  const libraryNames = (libraryRows ?? []).map((r) => r.name as string);

  // Learned from past corrections via the "Ask the AI why" chat
  // (ai_program_builder_conversational_learning_idea.md) — plain prompt
  // injection, same pattern as the library names above. A coach's total
  // rule count is realistically tens, not thousands, so the full list
  // fits directly here every time; no retrieval layer needed.
  const { data: prefRows } = await supabase
    .from("coach_program_preferences")
    .select("condition_text, preference_text")
    .eq("coach_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  // spotter_feedback_learning_loop_research_sept19.md, Part 4: a
  // preference extracted from a Programming Spotter "Edit" decision
  // flows into this exact same injection point, tagged by source so it
  // reads distinctly from a conversation-derived rule.
  const { data: spotterPrefRows } = await supabase
    .from("spotter_coach_preferences")
    .select("condition_text, preference_text")
    .eq("coach_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const preferenceLines = [
    ...(prefRows ?? []).map((p) => `- When ${p.condition_text}: ${p.preference_text}`),
    ...(spotterPrefRows ?? []).map(
      (p) => `- When ${p.condition_text}: ${p.preference_text} (from Programming Spotter feedback)`
    ),
  ];
  const preferencesText = preferenceLines.length > 0 ? preferenceLines.join("\n") : "(none yet)";

  // Gap A (spotter_gap_audit_and_ai_quality_bar_research_sept15.md): the
  // real, persisted, RPE-aware training-max estimate (lib/rpe-training-
  // max.ts, athlete_training_maxes) already exists but never reached this
  // prompt — every percentage-based ask ("write a 5/3/1 block for Sarah")
  // had no real number to compute from and either left weights null or
  // invented one. This route has no single athleteId (a generated draft
  // isn't assigned to a specific client until the review step) — so
  // rather than requiring one, every athlete on this roster's real
  // current maxes are listed by name, same "dump the coach's own real
  // data as context, let the model use what's relevant" pattern already
  // used for the exercise library and learned preferences above.
  const { data: athleteRows } = await supabase
    .from("group_memberships")
    .select("profile_id, profiles ( full_name )")
    .eq("group_id", groupId)
    .eq("role", "athlete");
  const athleteIds = (athleteRows ?? []).map((r) => r.profile_id);
  const { data: trainingMaxRows } =
    athleteIds.length > 0
      ? await supabase
          .from("athlete_training_maxes")
          .select("athlete_id, exercise_name, estimated_max")
          .in("athlete_id", athleteIds)
      : { data: [] as { athlete_id: string; exercise_name: string; estimated_max: number }[] };
  const nameByAthleteId = new Map(
    (athleteRows ?? []).map((r: any) => [r.profile_id, r.profiles?.full_name ?? "Client"])
  );
  const maxesByAthlete = new Map<string, string[]>();
  for (const row of trainingMaxRows ?? []) {
    const name = nameByAthleteId.get(row.athlete_id) ?? "Client";
    const list = maxesByAthlete.get(name) ?? [];
    list.push(`${row.exercise_name}: ${row.estimated_max}`);
    maxesByAthlete.set(name, list);
  }
  const trainingMaxesText =
    maxesByAthlete.size > 0
      ? [...maxesByAthlete.entries()].map(([name, lifts]) => `- ${name} — ${lifts.join(", ")}`).join("\n")
      : "(no logged sets yet for anyone on this roster)";

  try {
    const text = await callClaude({
      meta: { feature: "program_generation", userId: user.id },
      system: buildSystemPrompt(hasInjuryContext),
      userText:
        `Coach's exercise library (prefer these exact names where they fit):\n${libraryNames.join(", ") || "(empty — invent sensible exercise names)"}\n\n` +
        `This coach's standing preferences, learned from past corrections:\n${preferencesText}\n\n` +
        `Real current training maxes for this roster (RPE-estimated from actual logged sets — only use one of these if the description names that specific athlete or is clearly for them):\n${trainingMaxesText}\n\n` +
        (injuryContextText ? `Athlete injury/health context:\n${injuryContextText}\n\n` : "") +
        `Program description: ${prompt.trim()}`,
      // 8192 truncated mid-JSON on a routine request (8 weeks x 3 days,
      // ~130+ exercise rows) — a program's row count scales with
      // duration x frequency x exercises/day, easily exceeding a budget
      // sized for a single day's worth of content. 16384 still wasn't
      // enough for the same request.
      maxTokens: 32000,
    });

    const parsed = JSON.parse(extractJson(text));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rows)) {
      return NextResponse.json(
        { error: "AI response wasn't in the expected shape — try rephrasing your description." },
        { status: 502 }
      );
    }

    // The output-side guard (injury_pain_science_research_and_ai_gap_
    // sept15.md) — same "reject non-compliant output, never silently
    // pass it through" philosophy as coach-briefing-numeral-guard.ts,
    // scoped honestly: this checks that the model actually ENGAGED with
    // the flagged constraint, not that the resulting program is
    // clinically correct (nothing in this codebase, or a keyword guard,
    // could verify that without the LLM classifier already flagged
    // elsewhere as a separate, materially bigger, deferred project).
    if (hasInjuryContext && (typeof parsed.injuryConsiderations !== "string" || !parsed.injuryConsiderations.trim())) {
      return NextResponse.json(
        {
          error:
            "This client has a flagged health/injury concern, and the AI's response didn't address it — try again, or add more detail to their coach notes first.",
        },
        { status: 502 }
      );
    }

    const rows: ParsedImportRow[] = parsed.rows.filter(isValidRow).map((r: any) => ({
      week: r.week,
      day: r.day,
      exerciseName: r.exerciseName,
      sets: Math.max(1, Math.round(r.sets)),
      reps: r.reps != null ? String(r.reps) : null,
      weight: typeof r.weight === "number" ? r.weight : null,
      rpe: typeof r.rpe === "number" ? r.rpe : null,
      rest: r.rest != null ? String(r.rest) : null,
      timeSeconds: typeof r.timeSeconds === "number" ? r.timeSeconds : null,
    }));

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Couldn't generate a program from that description — try adding more detail." },
        { status: 422 }
      );
    }

    const programName = typeof parsed.programName === "string" && parsed.programName.trim()
      ? parsed.programName.trim()
      : "AI-Generated Program";
    const sequencingNotes =
      typeof parsed.sequencingNotes === "string" && parsed.sequencingNotes.trim()
        ? parsed.sequencingNotes.trim()
        : null;
    const injuryConsiderations =
      typeof parsed.injuryConsiderations === "string" && parsed.injuryConsiderations.trim()
        ? parsed.injuryConsiderations.trim()
        : null;

    // Real, self-reported-and-then-cross-checked prompt-adherence —
    // ai_output_validation_audit_findings_sept30.md found zero post-
    // generation check existed for equipment/exclusion/split adherence.
    // Never auto-rejects (the suggestive-only/coach-is-QA principle) —
    // surfaced on the review screen so the coach sees it and decides.
    const rawAdherence = parsed.adherenceCheck && typeof parsed.adherenceCheck === "object" ? parsed.adherenceCheck : {};
    const adherenceCheck = {
      equipmentLimits: typeof rawAdherence.equipmentLimits === "string" ? rawAdherence.equipmentLimits.trim() || null : null,
      exclusions: typeof rawAdherence.exclusions === "string" ? rawAdherence.exclusions.trim() || null : null,
      requestedSplit: typeof rawAdherence.requestedSplit === "string" ? rawAdherence.requestedSplit.trim() || null : null,
      violations: Array.isArray(rawAdherence.violations)
        ? rawAdherence.violations.filter((v: unknown) => typeof v === "string" && v.trim()).map((v: string) => v.trim())
        : [],
    };

    // The hard, enforced half of the same finding: an AI-autonomous pick
    // must resolve to a real exercise in the coach's library. Never
    // trusts the prompt alone — every row is checked here regardless of
    // what the model claims it did. A coach's own explicitly-named
    // exercise (detected by literal substring match against their own
    // prompt text) is exempt and is backfilled into the library by the
    // existing import flow. Video presence is deliberately not checked.
    const libraryForMatching: LibraryExercise[] = libraryNames.map((name) => ({ name }));
    const promptLower = prompt.toLowerCase();
    const libraryFlags: { exerciseName: string; flaggedReason: string }[] = [];

    // An empty library gives nothing to match against — the prompt
    // already told the model to invent sensible names in that case.
    const enforcedRows =
      libraryForMatching.length === 0
        ? rows
        : rows.map((row) => {
            const coachNamed = promptLower.includes(row.exerciseName.trim().toLowerCase());
            if (coachNamed) return row;

            // Any exact/alias/fuzzy match is a real library entry — fuzzy
            // ones already get arbitrated by the existing review step.
            const match = matchExercise(row.exerciseName, libraryForMatching, []);
            if (match.exerciseName) return row;

            // A genuine hallucination: nearest real library match where
            // one is close enough, otherwise flagged — never silently
            // created as a new library row.
            const [nearest] = matchTopN(row.exerciseName, libraryForMatching, [], 1);
            if (nearest && nearest.score >= 0.4) {
              libraryFlags.push({
                exerciseName: nearest.exerciseName,
                flaggedReason: `Substituted for "${row.exerciseName}" — that name isn't in your library.`,
              });
              return { ...row, exerciseName: nearest.exerciseName };
            }

            libraryFlags.push({
              exerciseName: row.exerciseName,
              flaggedReason: "Not in your library, and no close match was found — review before using.",
            });
            return row;
          });

    // Spend happens only now, on a genuine success — a failed/truncated/
    // empty-rows generation above never reaches here and never costs a
    // credit (coach_output_foolproofing's own "a bad output inside a
    // directly-priced purchase is a real, specific loss" principle).
    const spend = await checkAndSpendCoachCredits(supabase, user.id, "program_generation");
    if (!spend.ok) {
      return NextResponse.json({ error: spend.error }, { status: 402 });
    }

    return NextResponse.json({
      rows: enforcedRows,
      programName,
      sequencingNotes,
      injuryConsiderations,
      libraryFlags,
      adherenceCheck,
    });
  } catch (err) {
    if (err instanceof AiRateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof AiTruncatedError) {
      return NextResponse.json(
        {
          error:
            "That description generated too much content for one request. Try a shorter duration, fewer days per week, or fewer exercises per day — or split a long program into phases and generate each separately.",
        },
        { status: 502 }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't generate a program: ${message}` }, { status: 502 });
  }
}
