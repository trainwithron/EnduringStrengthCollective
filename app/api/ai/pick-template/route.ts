import { readHealthAnswers, HEALTH_READ_FAILED_MESSAGE } from "@/lib/health-answers";
import { freeTierUseOrRefuse } from "@/lib/free-tier-server";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError, AiTruncatedError, AiTimeoutError } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { checkAndSpendCoachCredits, canRunAiAction } from "@/lib/coach-credits";
import { hasFlaggedMusculoskeletalConcern } from "@/lib/athlete-injury-flag";
import { athleteAgeStatus, effectiveAgeStatus, YOUTH_PROMPT_BLOCK } from "@/lib/youth-block";
import { scanConstraints } from "@/lib/constraint-scan";
import { learnedBlock, loadLearnedLines } from "@/lib/learned-for-prompt";
import { loadNotesBlock } from "@/lib/client-notes-server";
import { loadReferenceBlock } from "@/lib/reference-context";
import { choicesForSlot, slotLabel, type LadderRung, type Level, type Side, type SlotTier } from "@/lib/slot-templates";
import { dayHeading, type TemplateSlot } from "@/lib/use-template";
import {
  PICK_FAILED_MESSAGE,
  TEMPLATE_PICK_MAX_TEXT,
  TEMPLATE_PICK_SYSTEM,
  TEMPLATE_PICK_TRUNCATED_NOTE,
  buildTemplatePickUserText,
  implementOf,
  levelUsed,
  readTemplatePicks,
  type TemplateSlotCandidates,
} from "@/lib/ai-from-template";

export const maxDuration = 60;

const LEVELS = new Set(["beginner", "intermediate", "advanced"]);

// "Pick for me" in Use this template: the coach says who the template is for; the AI chooses, for every slot, among the candidates the code takes from the coach's own ladders (filtered by the slot's
// pattern, side and class). It never invents an exercise, and nothing is saved here: the panel shows the picks with their reasons and the coach confirms. One call for the whole template, counted as one
// program run and charged only after a usable answer comes back (never on a failure or a cut-off answer).
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isAiConfigured()) return NextResponse.json({ error: "The AI isn't available yet." }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const programId = typeof body.programId === "string" ? body.programId : "";
  const text = typeof body.text === "string" ? body.text.slice(0, TEMPLATE_PICK_MAX_TEXT) : "";
  const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId : null;
  const chosenLevel = typeof body.level === "string" && LEVELS.has(body.level) ? (body.level as Level) : null;
  if (!programId) return NextResponse.json({ error: "Missing template." }, { status: 400 });

  const { data: program } = await supabase.from("programs").select("id, group_id").eq("id", programId).maybeSingle();
  if (!program) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", program.group_id as string).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "coach") return NextResponse.json({ error: "Only coaches can use templates." }, { status: 403 });

  const canRun = await canRunAiAction(supabase, user.id, "program_generation");
  if (!canRun.ok) return NextResponse.json({ error: canRun.error }, { status: 402 });

  // The slots of the template and the ladders they draw from (the same reads as the panel).
  const { data: rows } = await supabase
    .from("workouts")
    .select("week_number, day_index, group_workout_exercises!inner ( id, exercise_order, movement_pattern_id, slot_side, slot_tier )")
    .eq("program_id", programId)
    .eq("group_workout_exercises.is_slot", true);
  const slots: TemplateSlot[] = [];
  for (const w of (rows ?? []) as any[]) {
    for (const e of w.group_workout_exercises ?? []) {
      if (e.movement_pattern_id) slots.push({ rowId: e.id, week: w.week_number, day: w.day_index, order: e.exercise_order, patternId: e.movement_pattern_id, patternName: "", side: (e.slot_side as Side | null) ?? null, tier: (e.slot_tier as SlotTier | null) ?? null });
    }
  }
  if (slots.length === 0) return NextResponse.json({ error: "This template has no slots to fill." }, { status: 400 });
  slots.sort((a, b) => a.week - b.week || a.day - b.day || a.order - b.order);
  const patternIds = [...new Set(slots.map((s) => s.patternId))];
  const [{ data: patternRows }, { data: rungRows }] = await Promise.all([
    supabase.from("movement_patterns").select("id, name").in("id", patternIds),
    supabase.from("movement_pattern_exercises").select("movement_pattern_id, exercise_name, difficulty_rank, tier, is_unilateral").in("movement_pattern_id", patternIds),
  ]);
  const nameById = new Map<string, string>(((patternRows ?? []) as any[]).map((p) => [p.id as string, p.name as string]));
  const ladders: Record<string, LadderRung[]> = {};
  for (const r of (rungRows ?? []) as any[]) {
    (ladders[r.movement_pattern_id] ??= []).push({ exerciseName: r.exercise_name, rank: Number(r.difficulty_rank) || 0, tier: (r.tier as SlotTier | null) ?? null, unilateral: !!r.is_unilateral });
  }

  // Movement tags for the candidates (the coach's own tag reads; empty when there are none).
  const candidateNames = [...new Set(Object.values(ladders).flat().map((r) => r.exerciseName))];
  const tagsByName = new Map<string, string[]>();
  if (candidateNames.length > 0) {
    const { data: tagRows } = await supabase.from("exercise_biomech_tags").select("exercise_name, biomech_tags ( label )").in("exercise_name", candidateNames.slice(0, 400));
    for (const t of (tagRows ?? []) as any[]) {
      const label = (t.biomech_tags as { label?: string } | null)?.label;
      if (label) tagsByName.set(t.exercise_name, [...(tagsByName.get(t.exercise_name) ?? []), label]);
    }
  }

  const slotCandidates: TemplateSlotCandidates[] = slots.map((s, i) => {
    const id = `S${i + 1}`;
    const { rungs } = choicesForSlot({ patternName: nameById.get(s.patternId) ?? "Pattern", side: s.side, tier: s.tier }, ladders[s.patternId] ?? []);
    return {
      id,
      rowId: s.rowId,
      label: `${dayHeading(s.week, s.day)} · ${slotLabel({ patternName: nameById.get(s.patternId) ?? "Pattern", side: s.side, tier: s.tier })}`,
      candidates: rungs.map((r, j) => ({ id: `${id}.${j + 1}`, name: r.exerciseName, rank: r.rank, tier: r.tier, unilateral: r.unilateral, implement: implementOf(r.exerciseName), tags: tagsByName.get(r.exerciseName) ?? [] })),
    };
  });

  // The client's stored level and safety notes, read as this coach (the same reads as the day builder). Nothing here is sent anywhere but the model.
  let storedLevel: Level | null = null;
  let injuryContext: string | null = null;
  let youthBlock: string | null = null;
  if (clientId) {
    const { data: seat } = await supabase.from("group_memberships").select("training_level").eq("profile_id", clientId).eq("group_id", program.group_id as string).maybeSingle();
    storedLevel = ((seat as { training_level?: Level | null } | null)?.training_level ?? null) as Level | null;
    const [parQ, { data: noteRow }] = await Promise.all([
      readHealthAnswers(supabase, clientId),
      supabase.from("athlete_notes").select("body").eq("athlete_id", clientId).eq("group_id", program.group_id as string).maybeSingle(),
    ]);
    // A screening that could not be read is not "no concern": nothing is generated.
    if (parQ.kind === "error") return NextResponse.json({ error: HEALTH_READ_FAILED_MESSAGE }, { status: 503 });
    const flagged = hasFlaggedMusculoskeletalConcern(parQ.kind === "ok" ? parQ.answers : []);
    const noteText = noteRow?.body?.trim() || null;
    if (flagged || noteText) injuryContext = `This client has flagged a musculoskeletal or health concern${flagged ? " on their intake screening" : ""}.${noteText ? ` The coach's own note: "${noteText}"` : ""}`;
    // Under 18, or no birthdate on file: the youth protections apply (an unknown age is never treated as an adult).
    if (effectiveAgeStatus(await athleteAgeStatus(supabase, clientId), clientId === user.id) !== "adult") youthBlock = YOUTH_PROMPT_BLOCK;
  }
  const level = levelUsed(text, storedLevel ?? chosenLevel);
  const taught = learnedBlock(await loadLearnedLines(supabase, user.id, clientId));
  const notes = await loadNotesBlock(supabase, user.id, clientId);
  const referenceId = typeof body.referenceClientId === "string" && /^[0-9a-f-]{36}$/i.test(body.referenceClientId) ? body.referenceClientId : null;
  const reference = await loadReferenceBlock(supabase, user.id, referenceId, program.group_id as string);

  const noFreeUse = await freeTierUseOrRefuse(user!.id, "program");
  if (noFreeUse) return noFreeUse;

  async function attempt(retryNote: string | null) {
    const answer = await callClaude({ retryOnTruncation: false,
      meta: { feature: "program_template", userId: user!.id },
      system: TEMPLATE_PICK_SYSTEM,
      userText: buildTemplatePickUserText({ slots: slotCandidates, level, text, injuryContext, youthBlock, retryNote, learnedBlock: taught, notesBlock: notes, referenceBlock: reference }),
      maxTokens: 4000,
      timeoutMs: retryNote ? 25_000 : 30_000,
    });
    return JSON.parse(extractJson(answer));
  }

  try {
    let parsed: unknown;
    try {
      parsed = await attempt(null);
    } catch (err) {
      // Cut off: ask once more for a shorter answer (never charged until a usable answer comes back).
      if (!(err instanceof AiTruncatedError)) throw err;
      parsed = await attempt(TEMPLATE_PICK_TRUNCATED_NOTE);
    }
    const picks = readTemplatePicks(parsed, slotCandidates, text);
    // Charged only for a usable answer: if not one slot got an exercise, the coach pays nothing and is told to try again.
    if (!picks.some((p) => p.exercise)) return NextResponse.json({ error: PICK_FAILED_MESSAGE }, { status: 502 });
    const spend = await checkAndSpendCoachCredits(createServiceRoleClient(), user.id, "program_generation");
    if (!spend.ok) return NextResponse.json({ error: spend.error }, { status: 402 });
    // The same "worth a look" checks as the day builder, on everything the AI chose itself (an exercise the coach named is theirs, never flagged).
    const asRows = picks
      .filter((p) => p.source === "ai" && p.exercise)
      .map((p) => {
        const s = slots.find((x) => x.rowId === p.rowId)!;
        return { week: `Week ${s.week}`, day: `Day ${s.day}`, exerciseName: p.exercise as string, sets: 3, reps: null, weight: null, rpe: null, rest: null, timeSeconds: null };
      });
    const flags = scanConstraints(text, asRows as never);
    return NextResponse.json({ level, picks, flags });
  } catch (e) {
    if (e instanceof AiRateLimitedError) return NextResponse.json({ error: e.message }, { status: 429 });
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: "The AI isn't available yet." }, { status: 503 });
    if (e instanceof AiTruncatedError || e instanceof AiTimeoutError) return NextResponse.json({ error: PICK_FAILED_MESSAGE }, { status: 502 });
    return NextResponse.json({ error: PICK_FAILED_MESSAGE }, { status: 500 });
  }
}
