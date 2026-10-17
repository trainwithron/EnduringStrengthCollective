import { fetchStandingHistories } from "@/lib/standing-macros";
import { standingForDate } from "@/lib/macro-resolution";
import { computeScheduledDates } from "@/lib/program-schedule";
import {
  computeProgramEndingSuggestions,
  computeMacrosMissingSuggestions,
  computeSuggestedReminderDate,
  type AthleteProgramInfo,
  type AthleteMacroInfo,
  type ReminderRule,
} from "@/lib/coaching-suggestions";
import { isStillOnboarding } from "@/lib/client-onboarding";
import { firstNameOf, isSnoozed } from "@/lib/attention-snooze";
import type { NeedsAttentionItem } from "@/components/coach/desktop/needs-attention-panel";

// Puts one reminder on the calendar. True when it is there afterwards: just written, or already there (a unique-key conflict, 23505). False when the write failed, so the item is not labelled "On your calendar".
async function addSuggestion(supabase: any, row: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.from("calendar_events").insert(row);
  if (error && error.code !== "23505") {
    console.error("needs-attention: could not add the reminder to the calendar:", error.message);
    return false;
  }
  return true;
}

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

  const { data: groupRows } = await supabase.from("groups").select("id, name, group_kind").in("id", groupIds);
  const groupNameById = new Map<string, string>((groupRows ?? []).map((g: any) => [g.id, g.name]));
  const oneOnOneGroupIds = new Set<string>((groupRows ?? []).filter((g: any) => g.group_kind === "one_on_one").map((g: any) => g.id as string));

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

  // coach_sets_macros is the "No macros for [name]" switch; a database that does not have the column yet reads as on for everyone.
  const withMacrosSwitch = await supabase
    .from("group_memberships")
    .select("profile_id, group_id, client_tier, joined_at, coach_sets_macros, profiles ( full_name, intake_required )")
    .in("group_id", groupIds)
    .eq("role", "athlete");
  const allAthleteRows = withMacrosSwitch.error
    ? (
        await supabase
          .from("group_memberships")
          .select("profile_id, group_id, client_tier, joined_at, profiles ( full_name, intake_required )")
          .in("group_id", groupIds)
          .eq("role", "athlete")
      ).data
    : withMacrosSwitch.data;
  // "Not now": items the coach put off for a week stay hidden until that day passes (and come back only if they are still true).
  const { data: snoozeRows } = await supabase.from("attention_snoozes").select("athlete_id, trigger_key, until_date").eq("coach_id", coachId);
  const snoozed = (athleteId: string, triggerKey: string) =>
    (snoozeRows ?? []).some((r: any) => r.athlete_id === athleteId && r.trigger_key === triggerKey && isSnoozed(r.until_date as string, new Date()));

  interface AthleteRow {
    athleteId: string;
    athleteName: string;
    groupId: string;
    groupName: string;
    clientTier: "one_on_one" | "online" | "group" | null;
    macrosOff: boolean;
  }

  // Someone who just joined, or has not finished their intake, is still getting started: nothing is overdue for them yet.
  const rowIds = Array.from(new Set((allAthleteRows ?? []).map((a: any) => a.profile_id as string)));
  const { data: intakeRows } =
    rowIds.length > 0 ? await supabase.from("client_intake").select("athlete_id, completed_at").in("athlete_id", rowIds) : { data: [] };
  const intakeDone = new Set((intakeRows ?? []).filter((r: any) => r.completed_at).map((r: any) => r.athlete_id as string));
  const settledRows = (allAthleteRows ?? []).filter(
    (a: any) =>
      !isStillOnboarding({
        joinedAt: a.joined_at ?? null,
        intakeRequired: a.profiles?.intake_required === true,
        intakeCompleted: intakeDone.has(a.profile_id),
        now: new Date(),
      })
  );

  const allAthletes: AthleteRow[] = settledRows.map((a: any) => ({
    athleteId: a.profile_id as string,
    athleteName: (a.profiles?.full_name ?? "A client") as string,
    groupId: a.group_id as string,
    groupName: groupNameById.get(a.group_id) ?? "Group",
    clientTier: a.client_tier as "one_on_one" | "online" | "group" | null,
    // "No macros for [name]": this coach does not set macros for this client.
    macrosOff: a.coach_sets_macros === false,
  }));

  const athleteInfos: AthleteProgramInfo[] = [];

  for (const groupId of groupIds) {
    // In a one-on-one space only a program made for the client counts; a no-client program there is the coach's template.
    let programQuery = supabase.from("programs").select("id, start_date, training_days").eq("group_id", groupId).eq("is_active", true);
    if (oneOnOneGroupIds.has(groupId)) programQuery = programQuery.not("athlete_id", "is", null);
    const { data: activeProgram } = await programQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!activeProgram?.start_date || !activeProgram.training_days?.length) continue;

    const { data: workoutRows } = await supabase
      .from("workouts")
      .select("id, scheduled_date")
      .eq("program_id", activeProgram.id)
      .order("week_number", { ascending: true })
      .order("day_index", { ascending: true });

    if (!workoutRows || workoutRows.length === 0) continue;

    const scheduleMap = computeScheduledDates(
      activeProgram.start_date,
      activeProgram.training_days,
      workoutRows.map((w: any) => ({ id: w.id, scheduledDate: w.scheduled_date }))
    );
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
  const macroEligibleAthletes = allAthletes.filter((a) => a.clientTier !== "group" && !a.macrosOff);
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

  // A standing target covers every day of next week; only a client with neither
  // a standing target nor explicit rows is "missing macros".
  const standingByAthlete = await fetchStandingHistories(supabase, macroEligibleIds);

  const macroInfos: AthleteMacroInfo[] = macroEligibleAthletes.map((a) => ({
    ...a,
    daysWithMacrosNextWeek:
      standingForDate(standingByAthlete.get(a.athleteId), dateKey(nextWeekEnd))?.calories != null
        ? 7
        : macroDaysCountByAthlete.get(a.athleteId) ?? 0,
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

  const activeSuggestions = rawSuggestions.filter((s) => !programEndingHandled.has(s.athleteId) && !snoozed(s.athleteId, "program_ending"));
  const activeMacroSuggestions = rawMacroSuggestions.filter((s) => !macrosHandled.has(s.athleteId) && !snoozed(s.athleteId, "macros_missing"));
  const firstNames = new Map(allAthletes.map((a) => [a.athleteId, firstNameOf(a.athleteName)]));

  const needsAttentionItems: NeedsAttentionItem[] = [];

  for (const s of activeSuggestions) {
    const suggestedDate = computeSuggestedReminderDate(s.programEndDate, reminderRule, today);
    const suggestedDateKey = dateKey(suggestedDate);

    // A plain insert, not an upsert: the unique index on these rows is partial (only where trigger_key is set), which an ON CONFLICT clause cannot use (42P10). An already-there row (23505) is the point.
    const onCalendar = suggestionMode === "auto_add" && (await addSuggestion(supabase, {
      coach_id: coachId,
      title: s.title,
      event_date: suggestedDateKey,
      event_type: "suggestion",
      trigger_key: "program_ending",
      linked_athlete_id: s.athleteId,
      linked_group_id: s.groupId,
      status: "active",
    }));

    needsAttentionItems.push({
      athleteId: s.athleteId,
      groupId: s.groupId,
      title: s.title,
      triggerKey: "program_ending",
      firstName: firstNames.get(s.athleteId) ?? "this client",
      suggestedDateKey,
      alreadyOnCalendar: onCalendar,
    });
  }

  for (const s of activeMacroSuggestions) {
    const suggestedDateKey = dateKey(today);

    const onCalendar = suggestionMode === "auto_add" && (await addSuggestion(supabase, {
      coach_id: coachId,
      title: s.title,
      event_date: suggestedDateKey,
      event_type: "suggestion",
      trigger_key: "macros_missing",
      linked_athlete_id: s.athleteId,
      linked_group_id: s.groupId,
      status: "active",
    }));

    needsAttentionItems.push({
      athleteId: s.athleteId,
      groupId: s.groupId,
      title: s.title,
      triggerKey: "macros_missing",
      firstName: firstNames.get(s.athleteId) ?? "this client",
      suggestedDateKey,
      alreadyOnCalendar: onCalendar,
    });
  }

  return needsAttentionItems;
}
