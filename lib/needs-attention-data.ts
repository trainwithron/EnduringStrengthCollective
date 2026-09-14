import { computeScheduledDates } from "@/lib/program-schedule";
import {
  computeProgramEndingSuggestions,
  computeMacrosMissingSuggestions,
  computeSuggestedReminderDate,
  type AthleteProgramInfo,
  type AthleteMacroInfo,
  type ReminderRule,
} from "@/lib/coaching-suggestions";
import type { NeedsAttentionItem } from "@/components/coach/desktop/needs-attention-panel";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Extracted verbatim from app/groups/[groupId]/dashboard/page.tsx (the
// only place this logic previously lived) so the coach-desktop-shell's
// pinned "Needs attention" strip (mobile_home_workout_tab_merge_idea.md's
// sibling, coach_desktop_shell_identity_redesign.md) can reuse the exact
// same computation instead of duplicating it — the dashboard page's own
// call site is unchanged, just now delegates here.
export async function getNeedsAttentionItems(
  supabase: any,
  { coachId, groupIds }: { coachId: string; groupIds: string[] }
): Promise<NeedsAttentionItem[]> {
  if (groupIds.length === 0) return [];

  const { data: groupRows } = await supabase.from("groups").select("id, name").in("id", groupIds);
  const groupNameById = new Map<string, string>((groupRows ?? []).map((g: any) => [g.id, g.name]));

  const { data: prefsRow } = await supabase
    .from("coach_preferences")
    .select("suggestion_mode, suggestion_lead_days, suggestion_lead_mode, suggestion_lead_weekday")
    .eq("coach_id", coachId)
    .maybeSingle();

  const suggestionMode = (prefsRow?.suggestion_mode ?? "list") as "list" | "auto_add";
  const suggestionLeadDays = prefsRow?.suggestion_lead_days ?? 3;
  const suggestionLeadMode = (prefsRow?.suggestion_lead_mode ?? "days_before") as "days_before" | "weekday_before";
  const suggestionLeadWeekday = prefsRow?.suggestion_lead_weekday ?? 5;
  const reminderRule: ReminderRule =
    suggestionLeadMode === "weekday_before"
      ? { mode: "weekday_before", weekday: suggestionLeadWeekday }
      : { mode: "days_before", days: suggestionLeadDays };

  const today = new Date();

  const { data: allAthleteRows } = await supabase
    .from("group_memberships")
    .select("profile_id, group_id, client_tier, profiles ( full_name )")
    .in("group_id", groupIds)
    .eq("role", "athlete");

  interface AthleteRow {
    athleteId: string;
    athleteName: string;
    groupId: string;
    groupName: string;
    clientTier: "one_on_one" | "online" | "group" | null;
  }

  const allAthletes: AthleteRow[] = (allAthleteRows ?? []).map((a: any) => ({
    athleteId: a.profile_id as string,
    athleteName: (a.profiles?.full_name ?? "A client") as string,
    groupId: a.group_id as string,
    groupName: groupNameById.get(a.group_id) ?? "Group",
    clientTier: a.client_tier as "one_on_one" | "online" | "group" | null,
  }));

  const athleteInfos: AthleteProgramInfo[] = [];

  for (const groupId of groupIds) {
    const { data: activeProgram } = await supabase
      .from("programs")
      .select("id, start_date, training_days")
      .eq("group_id", groupId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeProgram?.start_date || !activeProgram.training_days?.length) continue;

    const { data: workoutRows } = await supabase
      .from("workouts")
      .select("id")
      .eq("program_id", activeProgram.id)
      .order("week_number", { ascending: true })
      .order("day_index", { ascending: true });

    if (!workoutRows || workoutRows.length === 0) continue;

    const scheduleMap = computeScheduledDates(activeProgram.start_date, activeProgram.training_days, workoutRows);
    const dates = Array.from(scheduleMap.values());
    if (dates.length === 0) continue;
    const programEndDate = new Date(Math.max(...dates.map((d) => d.getTime())));

    for (const a of allAthletes.filter((a) => a.groupId === groupId)) {
      athleteInfos.push({ ...a, programEndDate });
    }
  }

  const rawSuggestions = computeProgramEndingSuggestions(athleteInfos, today, reminderRule);

  const nextWeekStart = new Date(today);
  nextWeekStart.setDate(today.getDate() + 1);
  const nextWeekEnd = new Date(today);
  nextWeekEnd.setDate(today.getDate() + 7);
  const macroEligibleAthletes = allAthletes.filter((a) => a.clientTier !== "group");
  const macroEligibleIds = macroEligibleAthletes.map((a) => a.athleteId);

  const { data: macroRows } =
    macroEligibleIds.length > 0
      ? await supabase
          .from("daily_macros")
          .select("athlete_id, log_date")
          .in("athlete_id", macroEligibleIds)
          .gte("log_date", dateKey(nextWeekStart))
          .lte("log_date", dateKey(nextWeekEnd))
          .not("calories", "is", null)
      : { data: [] };

  const macroDaysCountByAthlete = new Map<string, number>();
  for (const row of macroRows ?? []) {
    macroDaysCountByAthlete.set(row.athlete_id, (macroDaysCountByAthlete.get(row.athlete_id) ?? 0) + 1);
  }

  const macroInfos: AthleteMacroInfo[] = macroEligibleAthletes.map((a) => ({
    ...a,
    daysWithMacrosNextWeek: macroDaysCountByAthlete.get(a.athleteId) ?? 0,
  }));

  const rawMacroSuggestions = computeMacrosMissingSuggestions(macroInfos);

  const athleteIdsInPlay = Array.from(
    new Set([...rawSuggestions.map((s) => s.athleteId), ...rawMacroSuggestions.map((s) => s.athleteId)])
  );
  const { data: existingSuggestionEvents } =
    athleteIdsInPlay.length > 0
      ? await supabase
          .from("calendar_events")
          .select("linked_athlete_id, trigger_key")
          .eq("coach_id", coachId)
          .eq("event_type", "suggestion")
          .in("linked_athlete_id", athleteIdsInPlay)
      : { data: [] };

  const programEndingHandled = new Set(
    (existingSuggestionEvents ?? []).filter((r: any) => r.trigger_key === "program_ending").map((r: any) => r.linked_athlete_id)
  );
  const macrosHandled = new Set(
    (existingSuggestionEvents ?? []).filter((r: any) => r.trigger_key === "macros_missing").map((r: any) => r.linked_athlete_id)
  );

  const activeSuggestions = rawSuggestions.filter((s) => !programEndingHandled.has(s.athleteId));
  const activeMacroSuggestions = rawMacroSuggestions.filter((s) => !macrosHandled.has(s.athleteId));

  const needsAttentionItems: NeedsAttentionItem[] = [];

  for (const s of activeSuggestions) {
    const suggestedDate = computeSuggestedReminderDate(s.programEndDate, reminderRule, today);
    const suggestedDateKey = dateKey(suggestedDate);

    if (suggestionMode === "auto_add") {
      await supabase.from("calendar_events").upsert(
        {
          coach_id: coachId,
          title: s.title,
          event_date: suggestedDateKey,
          event_type: "suggestion",
          trigger_key: "program_ending",
          linked_athlete_id: s.athleteId,
          linked_group_id: s.groupId,
          status: "active",
        },
        { onConflict: "coach_id,linked_athlete_id,trigger_key", ignoreDuplicates: true }
      );
    }

    needsAttentionItems.push({
      athleteId: s.athleteId,
      groupId: s.groupId,
      title: s.title,
      triggerKey: "program_ending",
      suggestedDateKey,
      alreadyOnCalendar: suggestionMode === "auto_add",
    });
  }

  for (const s of activeMacroSuggestions) {
    const suggestedDateKey = dateKey(today);

    if (suggestionMode === "auto_add") {
      await supabase.from("calendar_events").upsert(
        {
          coach_id: coachId,
          title: s.title,
          event_date: suggestedDateKey,
          event_type: "suggestion",
          trigger_key: "macros_missing",
          linked_athlete_id: s.athleteId,
          linked_group_id: s.groupId,
          status: "active",
        },
        { onConflict: "coach_id,linked_athlete_id,trigger_key", ignoreDuplicates: true }
      );
    }

    needsAttentionItems.push({
      athleteId: s.athleteId,
      groupId: s.groupId,
      title: s.title,
      triggerKey: "macros_missing",
      suggestedDateKey,
      alreadyOnCalendar: suggestionMode === "auto_add",
    });
  }

  return needsAttentionItems;
}
