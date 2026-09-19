import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findMatchingSlotForTrainer,
  rankTrainersByFit,
  resolveLocalDateForInstant,
  type GoalType,
  type RankedTrainer,
} from "./trainer-dispatch";
import { resolveBlockedRangesForDate, type AvailabilityWindow } from "./booking-slots";
import type { TrainingIntent } from "./training-intent";
import { DEFAULT_COACH_TIMEZONE } from "./timezone";

// The I/O layer for the pure logic in lib/trainer-dispatch.ts — reads
// every trainer in an org, filters to ones actually available at the
// prospect's requested instant, ranks the available ones by goal-fit.
// Mirrors lib/calendar-spotter-gather.ts's own split from
// lib/calendar-spotter.ts (pure detection vs. real Supabase reads).
export async function findAndRankAvailableTrainers(
  supabase: SupabaseClient,
  organizationId: string,
  requestedStartAt: Date,
  goalType: GoalType
): Promise<RankedTrainer[]> {
  const { data: members } = await supabase
    .from("organization_memberships")
    .select("profile_id, profiles ( full_name, timezone )")
    .eq("organization_id", organizationId);
  if (!members || members.length === 0) return [];

  const candidates: {
    trainerId: string;
    trainerName: string;
    intentCounts: Partial<Record<TrainingIntent, number>>;
  }[] = [];

  for (const m of members as any[]) {
    const trainerId: string = m.profile_id;
    const timezone: string = m.profiles?.timezone ?? DEFAULT_COACH_TIMEZONE;
    const trainerName: string = m.profiles?.full_name ?? "Trainer";

    const { data: windowRows } = await supabase
      .from("coach_availability_windows")
      .select("weekday, start_time, end_time, slot_duration_minutes")
      .eq("coach_id", trainerId);
    if (!windowRows || windowRows.length === 0) continue;

    const windows: AvailabilityWindow[] = windowRows.map((w: any) => ({
      weekday: w.weekday,
      startTime: w.start_time,
      endTime: w.end_time,
      slotDurationMinutes: w.slot_duration_minutes,
    }));

    const localDate = resolveLocalDateForInstant(requestedStartAt, timezone);
    const { data: exceptionRows } = await supabase
      .from("coach_availability_exceptions")
      .select("kind, start_at, end_at, weekday, start_time, end_time")
      .eq("coach_id", trainerId);
    const blockedRanges = resolveBlockedRangesForDate(
      localDate,
      (exceptionRows ?? []).map((e: any) => ({
        kind: e.kind,
        startAt: e.start_at,
        endAt: e.end_at,
        weekday: e.weekday,
        startTime: e.start_time,
        endTime: e.end_time,
      })),
      timezone
    );

    const match = findMatchingSlotForTrainer(requestedStartAt, windows, blockedRanges, timezone);
    if (!match) continue;

    const { data: programRows } = await supabase
      .from("programs")
      .select("training_intent")
      .eq("created_by", trainerId)
      .not("training_intent", "is", null);

    const intentCounts: Partial<Record<TrainingIntent, number>> = {};
    for (const p of programRows ?? []) {
      const intent = p.training_intent as TrainingIntent;
      intentCounts[intent] = (intentCounts[intent] ?? 0) + 1;
    }

    candidates.push({ trainerId, trainerName, intentCounts });
  }

  return rankTrainersByFit(candidates, goalType);
}
