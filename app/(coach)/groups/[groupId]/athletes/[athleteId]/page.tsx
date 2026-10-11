import { isEmailConfigured } from "@/lib/email";
import { ViewAsClientLink } from "@/components/coach/desktop/view-as-client-label";
import { SendSignInLinkButton } from "@/components/coach/send-signin-link-button";
import { ClientProfileTabs } from "@/components/coach/desktop/client-profile-tabs";
import { ClientProgramsSection } from "@/components/coach/desktop/client-programs-section";
import { isClientProfileTab } from "@/lib/client-profile-tabs";
import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { calorieSeriesWithStanding, standingForDate } from "@/lib/macro-resolution";
import { fetchStandingHistory } from "@/lib/standing-macros";
import { ClientNutrition } from "@/components/coach/nutrition/client-nutrition";
import { ClientFoodLogOnly } from "@/components/coach/nutrition/client-food-log-only";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SectionLoading } from "@/components/coach/desktop/section-loading";
import { ExerciseProgressionLoader } from "@/components/coach/desktop/exercise-progression-loader";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { AthleteNotesEditor } from "@/components/coach/athlete-notes-editor";
import { SessionCreditsControl } from "@/components/coach/session-credits-control";
import { buildCreditPicture, fetchBookingCounts } from "@/lib/credit-picture";
import { coachCreditSentence } from "@/lib/credit-sentence";
import { ledgerTotals } from "@/lib/credit-ledger-totals";
import { pageAll } from "@/lib/page-all";
import { AssignSessionsControl } from "@/components/coach/assign-sessions-control";
import { SessionLedgerList } from "@/components/coach/session-ledger-list";
import { ClientSeriesPanel, type SeriesView } from "@/components/coach/client-series-panel";
import { getGroupCoachTimezone } from "@/lib/timezone";
import { getViewerDisplayTimezone } from "@/lib/display-timezone-server";
import type { LedgerEntry } from "@/lib/session-ledger";
import { GoalConfirmationControl } from "@/components/coach/goal-confirmation-control";
import { GoalWaitingOnClient } from "@/components/coach/goal-waiting-on-client";
import { GoalProposalForm } from "@/components/athlete/goal-proposal-form";
import { findHelpAnswer } from "@/lib/help-answer";
import { PackageAssignmentControl } from "@/components/coach/package-assignment-control";
import { PrivateFromOrgToggle } from "@/components/coach/private-from-org-toggle";
import { ClientTagAssignmentControl } from "@/components/coach/client-tag-assignment-control";
import { DeleteClientControl } from "@/components/coach/delete-client-control";
import { SetAsideControl } from "@/components/coach/set-aside-control";
import { AddSocialOnlyMembershipControl } from "@/components/coach/add-social-only-membership-control";
import { ClientProgramActions } from "@/components/coach/client-program-actions";
import { ClientMessagesSection } from "@/components/coach/desktop/client-messages-section";
import { ClientCalendarSection } from "@/components/coach/desktop/client-calendar-section";
import { MinorConsentControl } from "@/components/coach/minor-consent-control";
import { ClientSignInPanel } from "@/components/coach/client-signin-panel";
import { CorrectClientEmail } from "@/components/coach/correct-client-email";
import { claimStatus, isPlaceholderEmail } from "@/lib/client-claim";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { claimLinkDetail } from "@/lib/invite-state";
import { GuardianShareButton } from "@/components/coach/guardian-share-button";
import { SettingsGroup } from "@/components/shared/settings-group";
import { InjuryStatusToggle } from "@/components/coach/injury-status-toggle";
import { VideoCheckinRecorder } from "@/components/coach/video-checkin-recorder";
import { ParQAnswersPanel } from "@/components/coach/par-q-answers-panel";
import { WaiverStatusLine } from "@/components/coach/waiver-status-line";
import { RosterSection } from "@/components/coach/desktop/roster-section";
import { isUnder13 } from "@/lib/coppa";
import { CoachLoggedBadge } from "@/components/coach-logged-badge";
import { TrendChart } from "@/components/coach/desktop/trend-chart";
import { isHabitDueOn, computeCompliancePct } from "@/lib/habits";
import { computeQuietTier } from "@/lib/quiet-client-tier";
import { isLowReadiness } from "@/lib/wellness";
import { deriveEventWindow, weeksUntilEvent, isWithinTaperWindow, daysUntilEvent } from "@/lib/event-window";
import { currentTaperMultiplier } from "@/lib/endurance-taper";
import { computeStrengthTaperWeek, computeHeavySingleWeight } from "@/lib/strength-meet-taper";
import { MainLiftPicker } from "@/components/coach/main-lift-picker";

// Every date key from `startKey` through `endKey`, inclusive.
function last7DatesForTargets(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startKey}T00:00:00Z`);
  const end = new Date(`${endKey}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export default async function AthleteProfilePage(
  props: {
    params: Promise<{ groupId: string; athleteId: string }>;
    searchParams?: Promise<{ tab?: string; month?: string; draft?: string }>;
  }
) {
  const params = await props.params;
  const searchParamsResolved = await props.searchParams;
  const tabParam = searchParamsResolved?.tab;
  const monthParam = searchParamsResolved?.month;
  // A drafted note (an expiry check-in, a come-back note) opens in the Messages box for the coach to edit; capped.
  const draftParam = (searchParamsResolved?.draft ?? "").slice(0, 600);
  const initialTab = isClientProfileTab(tabParam) ? tabParam : "overview";
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Wave 1 — every one of these queries depends only on `params`/
  // `user.id`, not on each other, so they run as one batch instead of
  // 23 sequential round trips. This page had grown to the worst
  // sequential-query count in the whole app (a client profile a coach
  // opens constantly, right before/after logging a session); this is
  // the real fix, same pattern already proven on the Calendar and
  // session-logging pages. `existingPlan` can't join this batch — it's
  // gated on `macrosEnabled`, which itself depends on this batch's own
  // `athleteMembership` result — so it moves to wave 2 below.
  const [
    { data: membership },
    { data: athleteMembership },
    { data: group },
    { data: personalProgram },
    { data: sharedProgramRaw },
    { data: allLogs },
    { data: noteRow },
    { data: creditsRow },
    { data: latestGoalRow },
    { data: sharedPhotoRows },
    { data: intake },
    { data: profileDetails },
    { data: privatePackageRows },
    { data: habitRows },
    { data: weightLogs },
    { data: calorieRows },
    { data: ouraConnection },
    { data: withingsConnection },
    { data: wellnessRows },
    { data: trainingMaxRows },
    { data: latestConfirmedEventGoal },
    { data: injuryStatusRow },
    { data: smsConsentRow },
    latestInviteFirst,
    { data: viewerProfile },
    { data: ledgerRows },
    ledgerAll,
    profileBookingCounts,
    seriesFirst,
    scheduleTimezone,
    displayZone,
    { data: threadRows },
    { data: coachMovementPatterns },
  ] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("role")
      .eq("group_id", params.groupId)
      .eq("profile_id", user.id)
      .maybeSingle(),
    supabase
      .from("group_memberships")
      .select(
        "joined_at, client_tier, private_from_org, profiles ( id, full_name, avatar_url, claimed_at )"
      )
      .eq("group_id", params.groupId)
      .eq("profile_id", params.athleteId)
      .maybeSingle(),
    supabase.from("groups").select("name, organization_id, group_kind").eq("id", params.groupId).single(),
    // This client's own personal program wins over the group's shared
    // one — same precedence as lib/todays-workout.ts. Both queries run
    // unconditionally rather than fetching shared only when personal
    // comes back empty — at most one extra, cheap row in the common
    // case, in exchange for removing a real sequential round trip.
    supabase
      .from("programs")
      .select("id, name")
      .eq("group_id", params.groupId)
      .eq("athlete_id", params.athleteId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("programs")
      .select("id, name")
      .eq("group_id", params.groupId)
      .is("athlete_id", null)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Stats (total count, volume, PRs) need every logged workout to
    // stay accurate, and the displayed history below is just the first
    // 50 of this same, already-descending-ordered list — one query
    // serves both instead of fetching workout_logs twice.
    supabase
      .from("workout_logs")
      .select(
        "id, session_id, total_volume, total_sets_completed, new_prs, created_at, logged_by_coach, workouts ( title, week_number, day_index )"
      )
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false }),
    supabase
      .from("athlete_notes")
      .select("id, body")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .maybeSingle(),
    supabase
      .from("session_credits")
      .select("balance")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .maybeSingle(),
    // Goal-date-aware nutrition/programming — the client always
    // proposes, the coach confirms. Only the most recent goal matters
    // here — an older one is history, shown on the client's own /goal
    // page, not repeated on this profile.
    supabase
      .from("client_goals")
      .select("id, goal_type, custom_label, target_date, priority_note, status, created_by, main_lift_movement_pattern_id")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Transformation Cards — only the specific photos this athlete has
    // explicitly chosen to share, never the full private journal. RLS
    // already enforces this, this query just matches that same filter.
    supabase
      .from("progress_photos")
      .select("id, storage_path, taken_date")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .eq("shared_with_coach", true)
      .order("taken_date", { ascending: false }),
    supabase
      .from("client_intake")
      .select("date_of_birth, par_q_answers, waiver_accepted, waiver_signed_name, completed_at")
      .eq("athlete_id", params.athleteId)
      .maybeSingle(),
    // Self-reported by the athlete in their own Settings — RLS already
    // scopes this to "self or a coach who actually coaches them."
    supabase
      .from("athlete_profile_details")
      .select(
        "bio, birthday, phone, emergency_contact_name, emergency_contact_phone, height_cm, biological_sex, body_fat_pct"
      )
      .eq("athlete_id", params.athleteId)
      .maybeSingle(),
    // Published packages need no assignment — every client already
    // sees them — so only private ones are relevant to assign here.
    supabase
      .from("coach_packages")
      .select("id, name, sessions_per_week, rate_cents, sessions_granted")
      .eq("group_id", params.groupId)
      .eq("is_active", true)
      .eq("is_public", false)
      .order("sessions_per_week", { ascending: true }),
    supabase
      .from("client_habits")
      .select("id, title, weekdays")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .eq("active", true),
    supabase
      .from("body_weight_logs")
      .select("id, logged_date, weight")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .order("logged_date", { ascending: false })
      .limit(20),
    // Coach-set calorie targets over time — deliberately the target,
    // not actual intake, since nothing in this app logs what a client
    // really ate.
    supabase
      .from("daily_macros")
      .select("log_date, calories")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .not("calories", "is", null)
      .order("log_date", { ascending: true }),
    supabase
      .from("wearable_connections")
      .select("id")
      .eq("profile_id", params.athleteId)
      .eq("provider", "oura")
      .maybeSingle(),
    supabase
      .from("wearable_connections")
      .select("id")
      .eq("profile_id", params.athleteId)
      .eq("provider", "withings")
      .maybeSingle(),
    supabase
      .from("wellness_checkins")
      .select("log_date, sleep_quality, soreness, energy")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .gte("log_date", (() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().slice(0, 10);
      })())
      .order("log_date", { ascending: true }),
    // AI Program Builder methodology grounding — real, persisted
    // training maxes, auto-estimated from logged sets. Read-only here.
    supabase
      .from("athlete_training_maxes")
      .select("exercise_name, estimated_max, updated_at")
      .eq("athlete_id", params.athleteId)
      .order("updated_at", { ascending: false }),
    // Peaking & Tapering — the shared event_window object, read here
    // just to surface a real "you're in taper" notice.
    supabase
      .from("client_goals")
      .select(
        "id, status, target_date, event_type, event_expected_duration_minutes, event_priority, weight_class_flag, goal_type, main_lift_movement_pattern_id"
      )
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .eq("status", "confirmed")
      .not("target_date", "is", null)
      .not("event_type", "is", null)
      .order("confirmed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // coach_em_up_finley_funston_transcript.md — real client-safety gap:
    // a manually-set "currently injured" flag that floors the nutrition
    // check-in engine's calorie target at maintenance, overriding any
    // active deficit phase.
    supabase
      .from("athlete_injury_status")
      .select("is_injured, surplus_pct, marked_at")
      .eq("athlete_id", params.athleteId)
      .maybeSingle(),
    // The client's own text-message consent (they set it in their
    // Settings; RLS lets their coach read it). Shown so the coach knows
    // what a text would actually reach before relying on it.
    supabase
      .from("athlete_sms_consent")
      .select("appointments, announcements, opted_out_at")
      .eq("athlete_id", params.athleteId)
      .maybeSingle(),
    // The latest sign-in link for a client who has not signed in (ignored below once they have). revoked_at comes from a later
    // database update: if that select errors it is retried without it below.
    supabase
      .from("client_invites")
      .select("created_at, expires_at, used_at, revoked_at")
      .eq("athlete_id", params.athleteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // The coach's own first name signs the text message they send the client.
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    // The session ledger (migration 0246). Until it exists the select errors and the list is simply empty.
    supabase
      .from("session_credit_ledger")
      .select("id, kind, amount, balance_after, note, created_at")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false })
      .limit(40),
    // Totals come from the whole history (the list above shows only the latest).
    pageAll((from, to) =>
      supabase.from("session_credit_ledger").select("id, kind, amount").eq("athlete_id", params.athleteId).eq("group_id", params.groupId).order("id", { ascending: true }).range(from, to)
    ),
    fetchBookingCounts(supabase, { athleteId: params.athleteId, groupId: params.groupId }),
    // Weekly schedules for this client (recurring_booking_series, 0210 + 0259). If the newer columns are not there yet this errors
    // and is retried with the original columns below.
    supabase
      .from("recurring_booking_series")
      .select("id, mode, status, weekday, start_time, duration_minutes, occurrences_total")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false })
      .limit(20),
    getGroupCoachTimezone(supabase, params.groupId),
    getViewerDisplayTimezone(supabase, user.id),
    // What the client said they need the most help with: found in the real conversation, never stored separately and never shown to the client.
    supabase
      .from("direct_messages")
      .select("sender_id, body, created_at")
      .eq("group_id", params.groupId)
      .or(`and(sender_id.eq.${user.id},recipient_id.eq.${params.athleteId}),and(sender_id.eq.${params.athleteId},recipient_id.eq.${user.id})`)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("movement_patterns").select("id, name").eq("created_by", user.id).order("name"),
  ]);

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can view client profiles.</NoAccess>
    );
  }

  if (!athleteMembership) {
    return (
      <NoAccess>This client isn&apos;t in this group.</NoAccess>
    );
  }

  const profile = athleteMembership.profiles as any;

  // A client the coach created before they ever signed in: the sign-in
  // checklist (and whether an invite link already exists) shows on top.
  // revoked_at comes from a later database update; without it the "cancelled" state just can't be told
  // apart from "used".
  const fetchLatestInvite = async (columns: string) =>
    profile?.claimed_at
      ? { data: null, error: null }
      : await supabase
          .from("client_invites")
          .select(columns)
          .eq("athlete_id", params.athleteId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
  let latestInviteResult: { data: unknown; error: unknown } = profile?.claimed_at ? { data: null, error: null } : latestInviteFirst;
  if (latestInviteResult.error) latestInviteResult = await fetchLatestInvite("created_at, expires_at, used_at");
  const latestInviteRow = latestInviteResult.data as unknown as {
    created_at: string;
    expires_at: string;
    used_at: string | null;
    revoked_at?: string | null;
  } | null;
  const signInDetail = claimLinkDetail({
    claimedAt: profile?.claimed_at ?? null,
    latestInvite: latestInviteRow
      ? {
          createdAt: latestInviteRow.created_at,
          expiresAt: latestInviteRow.expires_at,
          usedAt: latestInviteRow.used_at,
          revokedAt: latestInviteRow.revoked_at ?? null,
        }
      : null,
  });
  const signInStatus = claimStatus({
    claimedAt: profile?.claimed_at ?? null,
    latestInvite: latestInviteRow
      ? { expiresAt: latestInviteRow.expires_at, usedAt: latestInviteRow.used_at, revokedAt: latestInviteRow.revoked_at ?? null }
      : null,
  });
  const coachFirstName = (viewerProfile?.full_name ?? "").split(" ")[0] || null;
  // The client's address on the account, so a not-yet-signed-in client can be emailed their link (the coach typed it, or it came with the client).
  let signInEmailOnFile: string | null = null;
  if (signInStatus !== "active") {
    const { data: signInTarget } = await createServiceRoleClient().auth.admin.getUserById(params.athleteId);
    const signInEmail = signInTarget?.user?.email ?? null;
    signInEmailOnFile = signInEmail && !isPlaceholderEmail(signInEmail) ? signInEmail : null;
  }
  // Same gate used everywhere else this tier's feature set is hidden —
  // group-tier clients don't get macro/meal-plan programming at all.
  const macrosEnabled = athleteMembership.client_tier !== "group";

  // A one-on-one space has no shared program: a program with no client on it is the coach's template, not what this client follows.
  const sharedProgram = personalProgram || group?.group_kind === "one_on_one" ? null : sharedProgramRaw;
  const activeProgram = personalProgram ?? sharedProgram;
  const isMinor = !!intake?.date_of_birth && isUnder13(intake.date_of_birth, new Date());
  const todayKeyForWave2 = new Date().toISOString().slice(0, 10);
  // A strength-meet goal with a linked main-lift movement pattern (used by the taper notice below).
  const isStrengthMeetGoal = latestConfirmedEventGoal?.goal_type === "powerbuilding_strongman";
  const mainLiftPatternId = isStrengthMeetGoal
    ? (latestConfirmedEventGoal?.main_lift_movement_pattern_id as string | null) ?? null
    : null;

  // Wave 2 — each of these depends on a wave-1 result (or a pure JS
  // value derived from one), but not on each other, so they run as one
  // more batch instead of ~8 more sequential round trips.
  const [
    { data: activeProgramSchedule },
    { data: minorConsentRow },
    { data: guardianLinkRow },
    { data: assignmentRows },
    { data: habitLogRows },
    signedPhotoResults,
    { data: wearableMetrics },
    { data: withingsMetrics },
    { data: orgClientTagRows },
    { data: clientTagAssignmentRows },
    standingHistory,
    { data: mainLiftExerciseRows },
  ] = await Promise.all([
    activeProgram
      ? supabase.from("programs").select("training_days").eq("id", activeProgram.id).maybeSingle()
      : Promise.resolve({ data: null }),
    isMinor
      ? supabase
          .from("minor_consent")
          .select("verified, method, notes, verified_at")
          .eq("athlete_id", params.athleteId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    isMinor
      ? supabase
          .from("guardian_links")
          .select("access_token")
          .eq("athlete_id", params.athleteId)
          .eq("group_id", params.groupId)
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("package_assignments")
      .select("coach_package_id")
      .eq("athlete_id", params.athleteId)
      .in("coach_package_id", (privatePackageRows ?? []).map((p) => p.id)),
    supabase
      .from("habit_logs")
      .select("habit_id, log_date, completed_at")
      .in("habit_id", (habitRows ?? []).map((h) => h.id))
      .gte(
        "log_date",
        (() => {
          const d = new Date();
          d.setDate(d.getDate() - 6);
          return d.toISOString().slice(0, 10);
        })()
      )
      .lte("log_date", todayKeyForWave2),
    Promise.all(
      (sharedPhotoRows ?? []).map(async (p) => {
        const { data: signed } = await supabase.storage
          .from("progress-photos")
          .createSignedUrl(p.storage_path, 3600);
        return { id: p.id, takenDate: p.taken_date, signedUrl: signed?.signedUrl ?? null };
      })
    ),
    ouraConnection
      ? supabase
          .from("wearable_daily_metrics")
          .select("metric_date, metric_type, value")
          .eq("connection_id", ouraConnection.id)
          .gte(
            "metric_date",
            (() => {
              const d = new Date();
              d.setDate(d.getDate() - 30);
              return d.toISOString().slice(0, 10);
            })()
          )
      : Promise.resolve({ data: null }),
    withingsConnection
      ? supabase
          .from("wearable_daily_metrics")
          .select("metric_date, value")
          .eq("connection_id", withingsConnection.id)
          .eq("metric_type", "weight")
          .gte(
            "metric_date",
            (() => {
              const d = new Date();
              d.setDate(d.getDate() - 30);
              return d.toISOString().slice(0, 10);
            })()
          )
      : Promise.resolve({ data: null }),
    // organizational_only_group_kind_idea_sept16.md — every tag defined
    // for this group's own organization, for the assignment control
    // below. No org at all (a group not part of any organization) just
    // means no tags to offer, not an error.
    group?.organization_id
      ? supabase.from("client_tags").select("id, name").eq("organization_id", group.organization_id).order("name")
      : Promise.resolve({ data: null }),
    supabase.from("client_tag_assignments").select("tag_id").eq("athlete_id", params.athleteId),
    macrosEnabled ? fetchStandingHistory(supabase, params.athleteId, params.groupId) : Promise.resolve([]),
    mainLiftPatternId
      ? supabase
          .from("movement_pattern_exercises")
          .select("exercise_name")
          .eq("movement_pattern_id", mainLiftPatternId)
          .eq("tier", "A")
          .order("exercise_name")
          .limit(1)
      : Promise.resolve({ data: null }),
  ]);

  const sharedPhotos = signedPhotoResults;
  const parQAnswers = (intake?.par_q_answers as { question: string; answer: boolean }[]) ?? [];
  const parQFlaggedCount = parQAnswers.filter((a) => a.answer).length;
  const hasAboutInfo = !!(
    profileDetails?.bio ||
    profileDetails?.birthday ||
    profileDetails?.phone ||
    profileDetails?.emergency_contact_name
  );
  const assignedPackageIds = (assignmentRows ?? []).map((a) => a.coach_package_id);

  const totalCompleted = allLogs?.length ?? 0;
  const totalVolume = (allLogs ?? []).reduce((sum, l) => sum + (l.total_volume ?? 0), 0);

  const prEntries: { exerciseName: string; date: string }[] = [];
  for (const log of allLogs ?? []) {
    for (const name of log.new_prs ?? []) {
      prEntries.push({ exerciseName: name, date: log.created_at });
    }
  }
  prEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const RECENT_LOGS_LIMIT = 50;
  const workoutLogs = (allLogs ?? []).slice(0, RECENT_LOGS_LIMIT);

  // Last-7-days habit compliance — the one piece of this that's actually
  // measurable today. Macro targets are coach-set but nothing logs what
  // the athlete actually ate yet, so this deliberately reports "days with
  // a target set" rather than a fabricated "compliance" number for macros.
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const weekStartKey = sevenDaysAgo.toISOString().slice(0, 10);
  const todayKey = new Date().toISOString().slice(0, 10);
  const last7Dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sevenDaysAgo);
    d.setDate(d.getDate() + i);
    return d;
  });

  const activeHabits = habitRows ?? [];

  const completedSet = new Set(
    (habitLogRows ?? []).filter((l) => l.completed_at).map((l) => `${l.habit_id}:${l.log_date}`)
  );

  const habitCompliance = activeHabits.map((h) => {
    const dueDates = last7Dates.filter((d) => isHabitDueOn(h.weekdays, d));
    const completed = dueDates.filter((d) =>
      completedSet.has(`${h.id}:${d.toISOString().slice(0, 10)}`)
    ).length;
    return { title: h.title, completed, due: dueDates.length };
  });
  const totalHabitsDue = habitCompliance.reduce((sum, h) => sum + h.due, 0);
  const totalHabitsCompleted = habitCompliance.reduce((sum, h) => sum + h.completed, 0);

  // Coach-set calorie targets over time — deliberately the target, not
  // actual intake, since nothing in this app logs what a client really
  // ate. Reads clean because daily_macros is one row per real calendar
  // day (upserted, never duplicated) — clearing a day via the new "Clear
  // this day" control removes it here too, so a coach testing numbers
  // doesn't leave a fake point behind.
  const calorieTrend = calorieSeriesWithStanding(
    (calorieRows ?? []).map((r) => ({ date: r.log_date as string, value: r.calories as number })),
    standingHistory,
    "0000-01-01",
    todayKey
  );
  // Same rows as above, just the last-7-days slice — one query serves
  // both instead of a second round trip against the same table/filter.
  // A day counts as having a target if it has its own row, or the standing
  // target was already in place on it.
  const daysWithMacroTarget = last7DatesForTargets(weekStartKey, todayKey).filter(
    (d) =>
      (calorieRows ?? []).some((r) => r.log_date === d) ||
      standingForDate(standingHistory, d)?.calories != null
  ).length;

  const thirtyDaysAgoKey = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();

  const stepsTrend = (wearableMetrics ?? [])
    .filter((m) => m.metric_type === "steps")
    .map((m) => ({ date: m.metric_date, value: m.value }));
  const sleepScoreTrend = (wearableMetrics ?? [])
    .filter((m) => m.metric_type === "sleep_score")
    .map((m) => ({ date: m.metric_date, value: m.value }));

  const withingsWeightTrend = (withingsMetrics ?? []).map((m) => ({ date: m.metric_date, value: m.value }));

  const eventWindow = latestConfirmedEventGoal
    ? deriveEventWindow({
        status: latestConfirmedEventGoal.status,
        targetDate: latestConfirmedEventGoal.target_date,
        eventType: latestConfirmedEventGoal.event_type,
        eventExpectedDurationMinutes: latestConfirmedEventGoal.event_expected_duration_minutes,
        eventPriority: latestConfirmedEventGoal.event_priority as "A" | "B" | "C" | null,
        weightClassFlag: latestConfirmedEventGoal.weight_class_flag,
      })
    : null;
  const ENDURANCE_TAPER_WEEKS = 2;
  const todayDate = new Date();
  const weeksOut = eventWindow ? weeksUntilEvent(eventWindow, todayDate) : null;
  const inTaperWindow = eventWindow ? isWithinTaperWindow(eventWindow, todayDate, ENDURANCE_TAPER_WEEKS) : false;
  const taperMultiplier =
    eventWindow && weeksOut !== null ? currentTaperMultiplier(weeksOut, ENDURANCE_TAPER_WEEKS) : null;

  // Strength Meet Week Taper — the structural analog of the above, for
  // a powerbuilding/strongman goal with a linked main-lift movement
  // pattern. Only ever computed for that specific goal_type; an
  // endurance_event goal never reaches this branch, same as above never
  // reaching an endurance number for a strength goal.
  const strengthTaperWeek =
    isStrengthMeetGoal && eventWindow
      ? computeStrengthTaperWeek(daysUntilEvent(eventWindow, todayDate))
      : null;
  const mainLiftExerciseName = (mainLiftExerciseRows ?? [])[0]?.exercise_name as string | undefined;
  const mainLiftTrainingMax = mainLiftExerciseName
    ? (trainingMaxRows ?? []).find((r) => r.exercise_name === mainLiftExerciseName)?.estimated_max
    : undefined;
  const heavySingleWeight =
    strengthTaperWeek?.heavySinglePct != null && mainLiftTrainingMax != null
      ? computeHeavySingleWeight(mainLiftTrainingMax, strengthTaperWeek.heavySinglePct)
      : null;

  const sleepQualityTrend = (wellnessRows ?? []).map((r) => ({ date: r.log_date, value: r.sleep_quality }));
  const sorenessTrend = (wellnessRows ?? []).map((r) => ({ date: r.log_date, value: r.soreness }));
  const energyTrend = (wellnessRows ?? []).map((r) => ({ date: r.log_date, value: r.energy }));

  // The plain sentence about where their sessions stand: totals from the whole history (the list shows only the latest), booked and waiting-to-mark from the calendar.
  const profileCounts = profileBookingCounts.get(`${params.athleteId}:${params.groupId}`);
  const ledgerSums = ledgerTotals(ledgerAll.rows as { kind: string; amount: number }[], { prepaidAhead: profileCounts?.prepaidAhead ?? 0 });
  const ledgerEntries: LedgerEntry[] = (ledgerRows ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as LedgerEntry["kind"],
    amount: r.amount as number,
    balanceAfter: r.balance_after as number,
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as string,
  }));

  // What is still booked ahead for each weekly schedule. If the newer columns were not there yet the first select errored and is retried here with the original columns.
  let seriesResult = seriesFirst;
  if (seriesResult.error) {
    seriesResult = (await supabase
      .from("recurring_booking_series")
      .select("id, status, weekday, start_time, duration_minutes, occurrences_total")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false })
      .limit(20)) as unknown as typeof seriesResult;
  }
  const seriesRows = (seriesResult.data ?? []) as unknown as {
    id: string;
    mode?: string;
    status: string;
    weekday: number;
    start_time: string;
    duration_minutes: number;
    occurrences_total: number | null;
  }[];
  const upcomingBySeries = new Map<string, { bookingId: string; startIso: string }[]>();
  const frozenUntilById = new Map<string, string | null>();
  if (seriesRows.length > 0) {
    // The day a frozen schedule starts again (0297) is read apart from the main query so the page works before that update is applied.
    const [{ data: upcomingRows }, { data: frozenRows }] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, recurring_series_id, start_at")
        .in("recurring_series_id", seriesRows.map((r) => r.id))
        .eq("status", "confirmed")
        .gt("start_at", new Date().toISOString())
        .order("start_at", { ascending: true })
        .limit(400),
      supabase.from("recurring_booking_series").select("id, frozen_until").in("id", seriesRows.map((r) => r.id)),
    ]);
    for (const f of (frozenRows ?? []) as { id: string; frozen_until: string | null }[]) frozenUntilById.set(f.id, f.frozen_until ?? null);
    for (const b of (upcomingRows ?? []) as { id: string; recurring_series_id: string; start_at: string }[]) {
      const list = upcomingBySeries.get(b.recurring_series_id) ?? [];
      list.push({ bookingId: b.id, startIso: b.start_at });
      upcomingBySeries.set(b.recurring_series_id, list);
    }
  }
  const scheduleViews: SeriesView[] = seriesRows.map((r) => ({
    frozenUntil: frozenUntilById.get(r.id) ?? null,
    id: r.id,
    mode: r.mode === "ongoing" ? "ongoing" : "fixed",
    status: r.status as SeriesView["status"],
    weekday: r.weekday,
    startTime: String(r.start_time).slice(0, 5),
    durationMinutes: r.duration_minutes,
    occurrencesTotal: r.occurrences_total,
    upcoming: upcomingBySeries.get(r.id) ?? [],
  }));
  // What the client said they need the most help with: found in the real conversation (the question the coach sent and the client's first reply), never
  // stored separately and never shown to the client. Soft: if the lookup fails nothing is shown.
  const helpAnswer = findHelpAnswer(
    ((threadRows ?? []) as { sender_id: string; body: string; created_at: string }[]).map((r) => ({ senderId: r.sender_id, body: r.body, createdAt: r.created_at })),
    user.id,
    params.athleteId
  );
  const initials = (profile?.full_name ?? "?")
    .split(" ")
    .map((p: string) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Single-athlete flag banner — same signals/priority as Home's hero
  // (readiness > quiet tier > habits), scoped to just this one client.
  const todaysWellnessRow = (wellnessRows ?? []).find((r) => r.log_date === todayKey);
  const lastLoggedAt = allLogs?.[0]?.created_at ?? null;
  const quietTier = computeQuietTier({
    lastLoggedAt: lastLoggedAt ? new Date(lastLoggedAt) : null,
    now: new Date(),
    trainingDays: activeProgramSchedule?.training_days ?? null,
  });
  const habitCompliancePct = computeCompliancePct(totalHabitsCompleted, totalHabitsDue);

  let profileFlag: string | null = null;
  if (
    todaysWellnessRow &&
    isLowReadiness({
      sleepQuality: todaysWellnessRow.sleep_quality,
      soreness: todaysWellnessRow.soreness,
      energy: todaysWellnessRow.energy,
    })
  ) {
    profileFlag = "Logged low readiness today.";
  } else if (signInStatus === "active" && quietTier === "strong") {
    // Not for someone who has not signed in yet: a client added a minute ago has not "gone quiet".
    profileFlag = "Has gone quiet — worth a personal check-in.";
  } else if (signInStatus === "active" && quietTier === "mild") {
    profileFlag = "Hasn't logged in a while.";
  } else if (habitCompliancePct != null && habitCompliancePct < 50) {
    profileFlag = `Missed ${totalHabitsDue - totalHabitsCompleted} habit${totalHabitsDue - totalHabitsCompleted === 1 ? "" : "s"} this week.`;
  }

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="clients">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <Link
          href="/clients"
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to clients
        </Link>
        <div className="flex items-center gap-3 mt-3">
          {profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt=""
              className="w-14 h-14 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-surface border border-steel/30 flex items-center justify-center shrink-0">
              <span className="font-display text-lg text-chalk">{initials}</span>
            </div>
          )}
          <div>
            <h1 className="font-display font-bold text-2xl leading-none uppercase">
              {profile?.full_name ?? "Unknown"}
            </h1>
            <p className="font-body text-xs text-steel mt-1">
              Joined {new Date(athleteMembership.joined_at).toLocaleDateString("en-US", { timeZone: displayZone })}
              {activeProgram && (
                <>
                  {" · "}
                  <Link href={`/groups/${params.groupId}/programs/${activeProgram.id}`} className="hover:text-chalk underline underline-offset-2">
                    {activeProgram.name}
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
        {profileFlag && (
          <p className="font-body text-xs text-rust border border-rust/40 bg-rust/5 px-3 py-1.5 mt-3 inline-block">
            {profileFlag}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Link
            href={`/groups/${params.groupId}/athletes/${params.athleteId}/history`}
            className="inline-flex items-center h-9 font-body text-xs text-rust border border-rust px-3"
            title="Backfill training history from before this client joined — grounds the AI program builder"
          >
            Upload exercise history
          </Link>
          <VideoCheckinRecorder athleteId={params.athleteId} groupId={params.groupId} coachId={user.id} />
        </div>
      </div>

      <div id="client-profile-body" data-active-tab={initialTab}>
        <ClientProfileTabs groupId={params.groupId} athleteId={params.athleteId} initial={initialTab} />
        <div data-tab="messages" className="mb-8">
          {initialTab === "messages" && (
            <Suspense fallback={<SectionLoading />}>
              <ClientMessagesSection groupId={params.groupId} athleteId={params.athleteId} viewerId={user.id} clientName={profile?.full_name ?? "Client"} initialDraft={draftParam} />
            </Suspense>
          )}
        </div>
        <div data-tab="calendar" className="mb-8">
          {initialTab === "calendar" && (
            <Suspense fallback={<SectionLoading />}>
            <ClientCalendarSection
              groupId={params.groupId}
              athleteId={params.athleteId}
              coachId={user.id}
              athleteName={profile?.full_name ?? "Client"}
              macrosEnabled={athleteMembership.client_tier !== "group"}
              monthParam={monthParam}
              monthHref={(key) => `/groups/${params.groupId}/athletes/${params.athleteId}?tab=calendar&month=${key}`}
            />
            </Suspense>
          )}
        </div>
        <div data-tab="program" className="mb-8 max-w-3xl">
          <Suspense fallback={<SectionLoading />}>
          <ClientProgramsSection
            groupId={params.groupId}
            athleteId={params.athleteId}
            actions={
              <div className="mb-4">
                <ClientProgramActions
                  groupId={params.groupId}
                  athleteId={params.athleteId}
                  athleteFullName={profile?.full_name ?? "Client"}
                  extra={
                    <>
                      <span className="hidden lg:inline-flex">
                        <ViewAsClientLink href={`/groups/${params.groupId}/athletes/${params.athleteId}/view`} />
                      </span>
                      <Link
                        href={`/groups/${params.groupId}/athletes/${params.athleteId}/log`}
                        className="inline-flex items-center justify-center min-h-11 sm:h-9 font-body text-xs text-chalk border border-steel/40 px-3 font-medium"
                      >
                        <span className="lg:hidden">Log their workout</span>
                        <span className="hidden lg:inline">Log an in-person session</span>
                      </Link>
                    </>
                  }
                />
              </div>
            }
          />
          </Suspense>
        </div>

      <div className="profile-grid grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 lg:gap-10 items-start">
        <div className="space-y-8 min-w-0">
          <div data-tab="overview">
          {signInStatus !== "active" && (
            <ClientSignInPanel
              groupId={params.groupId}
              athleteId={params.athleteId}
              clientName={profile?.full_name ?? "Client"}
              status={signInStatus}
              linkDetail={signInDetail}
              coachFirstName={coachFirstName}
              emailOnFile={signInEmailOnFile}
            />
          )}
          </div>
          <div data-tab="overview">
          {signInStatus === "active" && (
            <>
              {/* Off until the email sender is set up (Oct 7): the safeguard for this tool is a notice to the OLD address, and mail is not on yet, so a coach
                  could otherwise change a signed-in client's login with nobody told. The client changes their own email in their Settings. */}
              {isEmailConfigured() ? (
                <CorrectClientEmail
                  groupId={params.groupId}
                  athleteId={params.athleteId}
                  clientName={profile?.full_name ?? "Client"}
                />
              ) : (
                <p className="font-body text-xs text-steel mt-4">To change their email, ask {profile?.full_name ?? "the client"} to change it in their own Settings.</p>
              )}
              <SendSignInLinkButton groupId={params.groupId} athleteId={params.athleteId} clientName={profile?.full_name ?? "this client"} />
            </>
          )}
          </div>
          <div data-tab="overview forms">
          {(hasAboutInfo || parQAnswers.length > 0 || !!intake) && (
            <RosterSection
              title="Personal Info"
              summary={
                parQFlaggedCount > 0
                  ? `Bio, contact & health screening (${parQFlaggedCount} flagged)`
                  : "Bio, contact & health screening"
              }
              needsAttentionCount={parQFlaggedCount}
              defaultExpanded={parQFlaggedCount > 0}
            >
              <div className="space-y-4">
                {hasAboutInfo && (
                  <div>
                    {profileDetails?.bio && (
                      <p className="font-body text-sm text-chalk mb-2">{profileDetails.bio}</p>
                    )}
                    <div className="font-body text-xs text-steel space-y-0.5">
                      {profileDetails?.birthday && (
                        <p>Birthday: {new Date(`${profileDetails.birthday}T00:00:00`).toLocaleDateString()}</p>
                      )}
                      {profileDetails?.phone && <p>Phone: {profileDetails.phone}</p>}
                      {profileDetails?.emergency_contact_name && (
                        <p>
                          Emergency contact: {profileDetails.emergency_contact_name}
                          {profileDetails?.emergency_contact_phone && ` · ${profileDetails.emergency_contact_phone}`}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <p className="font-body text-xs text-steel">
                  Text messages:{" "}
                  {!smsConsentRow || (!smsConsentRow.appointments && !smsConsentRow.announcements)
                    ? "not opted in"
                    : smsConsentRow.opted_out_at
                      ? "opted out (replied STOP)"
                      : [
                          smsConsentRow.appointments ? "appointments" : null,
                          smsConsentRow.announcements ? "check-ins and announcements" : null,
                        ]
                          .filter(Boolean)
                          .join(" + ")}
                </p>
                {parQAnswers.length > 0 && <ParQAnswersPanel answers={parQAnswers} />}
                {intake && (
                  <WaiverStatusLine
                    waiverAccepted={!!intake.waiver_accepted}
                    waiverSignedName={intake.waiver_signed_name}
                    completedAt={intake.completed_at}
                  />
                )}
              </div>
            </RosterSection>
          )}
          </div>
          <div data-tab="overview">
          <InjuryStatusToggle
            athleteId={params.athleteId}
            groupId={params.groupId}
            coachId={user.id}
            initialIsInjured={injuryStatusRow?.is_injured ?? false}
            initialSurplusPct={injuryStatusRow?.surplus_pct ?? 0}
          />
          </div>
          <div data-tab="overview progress">
          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Stats
            </h2>
            <div className="flex gap-6 pb-4 border-b border-steel/15">
              <div>
                <p className="font-display text-2xl">{totalCompleted}</p>
                <p className="font-body text-xs text-steel">Workouts</p>
              </div>
              <div>
                <p className="font-display text-2xl">
                  {Math.round(totalVolume).toLocaleString()}
                </p>
                <p className="font-body text-xs text-steel">Volume (lbs)</p>
              </div>
              <div>
                <p className="font-display text-2xl">{prEntries.length}</p>
                <p className="font-body text-xs text-steel">PRs</p>
              </div>
            </div>

            {prEntries.length > 0 && (
              <div className="py-4 border-b border-steel/15">
                <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                  Recent PRs
                </h3>
                <div className="space-y-1">
                  {prEntries.slice(0, 8).map((pr, i) => (
                    <p key={i} className="font-body text-sm">
                      {pr.exerciseName}{" "}
                      <span className="text-steel text-xs">
                        &middot; {new Date(pr.date).toLocaleDateString("en-US", { timeZone: displayZone })}
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </section>
          </div>

          <div data-tab="progress">
          {sharedPhotos.length > 0 && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Progress Photos Shared With You
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {sharedPhotos.map((photo) => (
                  <div key={photo.id}>
                    {photo.signedUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photo.signedUrl}
                        alt=""
                        className="w-full aspect-square object-cover"
                      />
                    )}
                    <p className="font-body text-xs text-steel mt-1">
                      {new Date(`${photo.takenDate}T00:00:00`).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
          </div>

          <div data-tab="overview">
          {(activeHabits.length > 0 || daysWithMacroTarget > 0) && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Last 7 Days
              </h2>
              <div className="pb-4 border-b border-steel/15 space-y-3">
                {activeHabits.length > 0 && (
                  <div>
                    <p className="font-body text-sm">
                      Habits:{" "}
                      <span className="font-medium">
                        {totalHabitsCompleted}/{totalHabitsDue}
                      </span>{" "}
                      check-ins
                      {totalHabitsDue > 0 && (
                        <span className="text-steel">
                          {" "}
                          ({Math.round((totalHabitsCompleted / totalHabitsDue) * 100)}%)
                        </span>
                      )}
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {habitCompliance.map((h) => (
                        <p key={h.title} className="font-body text-xs text-steel">
                          {h.title}: {h.completed}/{h.due}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                <p className="font-body text-sm text-steel">
                  Macro targets set: {daysWithMacroTarget}/7 days
                  <span className="block text-xs mt-0.5">
                    (tracks whether a target was set — actual intake isn&apos;t logged yet)
                  </span>
                </p>
              </div>
            </section>
          )}
          </div>

          <div data-tab="progress">
          {(trainingMaxRows ?? []).length > 0 && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Estimated Training Maxes
              </h2>
              <p className="font-body text-xs text-steel mb-2">
                Auto-estimated from logged sets (weight, reps, and RPE) — never a typed-in number, and only ever
                moves up as a harder set gets logged.
              </p>
              <div className="divide-y divide-steel/15">
                {(trainingMaxRows ?? []).map((row) => (
                  <div key={row.exercise_name} className="flex items-center justify-between py-2">
                    <span className="font-body text-sm">{row.exercise_name}</span>
                    <span className="font-body text-sm text-rust font-medium">
                      {Math.round(row.estimated_max)} lbs
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
          </div>

          <div data-tab="program">
          {eventWindow && inTaperWindow && !isStrengthMeetGoal && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Event Taper
              </h2>
              <div className="border border-rust/30 bg-surface px-4 py-3">
                <p className="font-body text-sm text-chalk">
                  {weeksOut === 0
                    ? `Race week for ${eventWindow.sportType ?? "their event"} — target date ${eventWindow.targetDate}.`
                    : `${weeksOut} week${weeksOut === 1 ? "" : "s"} out from ${eventWindow.sportType ?? "their event"} (${eventWindow.targetDate}).`}
                </p>
                <p className="font-body text-xs text-steel mt-1">
                  Recommended training volume this week: {Math.round((taperMultiplier ?? 1) * 100)}% of normal —
                  intensity/pace stays exactly where it is, only volume comes down.
                </p>
                <p className="font-body text-xs text-steel mt-1">
                  Nutrition note: don&apos;t cut calories to match the lower training volume this week — carb intake
                  should stay level or increase, not fall with it.
                </p>
                {eventWindow.weightClassFlag && (
                  <p className="font-body text-xs text-rust mt-2">
                    ⚠ Flagged as also cutting weight for a weight class — peaking and cutting at the same time has
                    no real evidence base to automate. Worth a direct conversation, not an automatic plan.
                  </p>
                )}
              </div>
            </section>
          )}
          </div>

          <div data-tab="program">
          {isStrengthMeetGoal && eventWindow && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Strength Meet Taper
              </h2>
              <div className="border border-rust/30 bg-surface px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-body text-sm text-chalk">
                    {eventWindow.sportType ?? "Meet"} — target date {eventWindow.targetDate}
                  </p>
                  <MainLiftPicker
                    goalId={latestConfirmedEventGoal!.id ?? ""}
                    movementPatterns={coachMovementPatterns ?? []}
                    currentPatternId={mainLiftPatternId}
                  />
                </div>
                {!mainLiftPatternId && (
                  <p className="font-body text-xs text-steel">
                    Link a main lift above to see taper guidance here once this client is within 2 weeks of the
                    meet.
                  </p>
                )}
                {mainLiftPatternId && !strengthTaperWeek && (
                  <p className="font-body text-xs text-steel">
                    More than 2 weeks out — this client&apos;s program stays exactly as you&apos;ve authored it
                    until taper guidance appears here.
                  </p>
                )}
                {strengthTaperWeek && (
                  <>
                    <p className="font-body text-xs text-steel">
                      {strengthTaperWeek.daysUntilMeet} day{strengthTaperWeek.daysUntilMeet === 1 ? "" : "s"} out
                      ({strengthTaperWeek.label === "t-1" ? "taper week" : "meet week"}).
                    </p>
                    <p className="font-body text-xs text-steel">
                      Recommended volume-load this week: {strengthTaperWeek.volumeLoadPctRange[0]}-
                      {strengthTaperWeek.volumeLoadPctRange[1]}% of your most recently authored week — scale it
                      down by hand, this doesn&apos;t touch the program itself.
                    </p>
                    {strengthTaperWeek.heavySinglePct != null && mainLiftExerciseName && (
                      <p className="font-body text-xs text-steel">
                        Keep one real heavy single at ~{strengthTaperWeek.heavySinglePct}% of current training max on{" "}
                        {mainLiftExerciseName}
                        {heavySingleWeight != null
                          ? ` — about ${heavySingleWeight} lbs.`
                          : " — no logged training max yet to compute a real number from."}
                      </p>
                    )}
                    {strengthTaperWeek.heavySinglePct != null && mainLiftPatternId && !mainLiftExerciseName && (
                      <p className="font-body text-xs text-steel">
                        Keep one real heavy single around 90-95% of current training max — the linked pattern has no
                        tier-A exercise set yet, so this can&apos;t compute a specific lift or weight.
                      </p>
                    )}
                    {strengthTaperWeek.label === "t-0" && (
                      <p className="font-body text-xs text-steel">
                        Assistance work to zero. Competition-lift practice only, at opener weights — no new PRs
                        attempted this week.
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
          )}
          </div>

          <div data-tab="overview forms">
          {isMinor && (
            <section className="space-y-3">
              <MinorConsentControl
                athleteId={params.athleteId}
                groupId={params.groupId}
                initialVerified={minorConsentRow?.verified ?? false}
                initialMethod={(minorConsentRow?.method as any) ?? null}
                initialNotes={minorConsentRow?.notes ?? ""}
                initialVerifiedAt={minorConsentRow?.verified_at ?? null}
              />
              <GuardianShareButton
                athleteId={params.athleteId}
                groupId={params.groupId}
                consentVerified={minorConsentRow?.verified ?? false}
                initialToken={guardianLinkRow?.access_token ?? null}
              />
            </section>
          )}
          </div>

          <div data-tab="overview forms">
          {latestGoalRow?.status === "proposed" && latestGoalRow.created_by !== params.athleteId && (
            <section>
              <GoalWaitingOnClient
                clientName={profile?.full_name ?? "the client"}
                goal={{
                  id: latestGoalRow.id,
                  goalType: latestGoalRow.goal_type,
                  customLabel: latestGoalRow.custom_label,
                  targetDate: latestGoalRow.target_date,
                  priorityNote: latestGoalRow.priority_note,
                }}
              />
            </section>
          )}
          </div>

          <div data-tab="overview forms">
          {helpAnswer && (
            <section className="border border-steel/20 p-3">
              <h2 className="font-body text-xs text-steel uppercase tracking-wide font-bold">
                What {(profile?.full_name ?? "they").split(" ")[0]} said they need most help with
              </h2>
              {helpAnswer.answer ? (
                <>
                  <p className="font-body text-sm text-chalk mt-2 whitespace-pre-wrap">{helpAnswer.answer}</p>
                  <p className="font-body text-xs text-steel mt-1">
                    Their reply on {new Date(helpAnswer.answeredAt as string).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: displayZone })}. Only you see this card.
                  </p>
                  {latestGoalRow?.status !== "proposed" && (
                    <details className="mt-3">
                      <summary className="font-body text-sm text-rust cursor-pointer">Turn this into a goal</summary>
                      <div className="mt-3">
                        <GoalProposalForm athleteId={params.athleteId} groupId={params.groupId} suggestedBy={user.id} fromWords={helpAnswer.answer} />
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <p className="font-body text-xs text-steel mt-2">
                  You asked on {new Date(helpAnswer.askedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: displayZone })}. No reply yet, and there is no need to chase it.
                </p>
              )}
            </section>
          )}
          </div>

          <div data-tab="overview forms">
          {latestGoalRow?.status !== "proposed" && (
            <section>
              <details className="border border-steel/20 p-3">
                <summary className="font-body text-xs text-steel uppercase tracking-wide font-bold cursor-pointer">Suggest a goal</summary>
                <div className="mt-3">
                  <GoalProposalForm athleteId={params.athleteId} groupId={params.groupId} suggestedBy={user.id} />
                </div>
              </details>
            </section>
          )}
          </div>

          <div data-tab="overview forms">
          {latestGoalRow?.status === "proposed" && latestGoalRow.created_by === params.athleteId && (
            <section>
              <GoalConfirmationControl
                goal={{
                  id: latestGoalRow.id,
                  goalType: latestGoalRow.goal_type,
                  customLabel: latestGoalRow.custom_label,
                  targetDate: latestGoalRow.target_date,
                  priorityNote: latestGoalRow.priority_note,
                }}
              />
            </section>
          )}
          </div>

          <section className="space-y-4">
            <div data-tab="settings">
            <SettingsGroup label="Billing">
              <p className="font-body text-sm text-chalk mb-3">
                {coachCreditSentence(
                  buildCreditPicture({
                    balance: creditsRow?.balance ?? 0,
                    booked: profileCounts?.booked ?? 0,
                    toMark: profileCounts?.toMark ?? 0,
                    bought: ledgerAll.failed ? null : ledgerSums.bought,
                    done: ledgerAll.failed ? null : ledgerSums.done,
                  }),
                  profile?.full_name ?? "This client"
                )}
              </p>
              <SessionCreditsControl
                key={`credits-${creditsRow?.balance ?? 0}`}
                athleteId={params.athleteId}
                groupId={params.groupId}
                initialBalance={creditsRow?.balance ?? 0}
              />
            </SettingsGroup>
            </div>

            <div data-tab="settings">
            <SettingsGroup label="Assign sessions">
              <AssignSessionsControl
                key={`assign-${creditsRow?.balance ?? 0}`}
                athleteId={params.athleteId}
                groupId={params.groupId}
                clientName={profile?.full_name ?? "this client"}
                initialBalance={creditsRow?.balance ?? 0}
              />
            </SettingsGroup>
            </div>

            <div data-tab="program">
            <SettingsGroup label="Weekly schedule">
              <ClientSeriesPanel
                groupId={params.groupId}
                athleteId={params.athleteId}
                athleteName={profile?.full_name ?? "this client"}
                timezone={scheduleTimezone}
                series={scheduleViews}
              />
            </SettingsGroup>
            </div>

            <div data-tab="settings">
            <SettingsGroup label="Session ledger">
              <SessionLedgerList balance={creditsRow?.balance ?? 0} entries={ledgerEntries.slice(0, 10)} />
            </SettingsGroup>
            </div>

            <div data-tab="settings">
            <SettingsGroup label="Packages">
              <PackageAssignmentControl
                athleteId={params.athleteId}
                privatePackages={(privatePackageRows ?? []).map((p) => ({
                  id: p.id,
                  name: p.name,
                  sessionsPerWeek: p.sessions_per_week,
                  rateCents: p.rate_cents,
                  sessionsGranted: p.sessions_granted,
                }))}
                initialAssignedIds={assignedPackageIds}
              />
            </SettingsGroup>
            </div>

            <div data-tab="settings">
            <SettingsGroup label="Privacy">
              <PrivateFromOrgToggle
                athleteId={params.athleteId}
                groupId={params.groupId}
                initialValue={athleteMembership.private_from_org ?? false}
              />
            </SettingsGroup>
            </div>

            <div data-tab="settings">
            {(orgClientTagRows ?? []).length > 0 && (
              <SettingsGroup label="Tags">
                <ClientTagAssignmentControl
                  athleteId={params.athleteId}
                  orgTags={(orgClientTagRows ?? []).map((t) => ({ id: t.id, name: t.name }))}
                  initialAssignedTagIds={(clientTagAssignmentRows ?? [])
                    .map((a) => a.tag_id)
                    .filter((tagId) => (orgClientTagRows ?? []).some((t) => t.id === tagId))}
                />
              </SettingsGroup>
            )}
            </div>
          </section>

          {/* "Move client" is hidden for now (Release F, Oct 7): move_client_to_group moves the balance but leaves the ledger, series, requests and waiting list behind
              (r2_03a M5), so the books stop adding up. components/coach/change-client-group-control.tsx is kept; put it back once the function is completed. */}

          <div data-tab="settings">
          <section>
            <AddSocialOnlyMembershipControl
              athleteId={params.athleteId}
              athleteName={profile?.full_name ?? "This client"}
              currentGroupId={params.groupId}
            />
          </section>
          </div>

          <div data-tab="settings">
          <section>
            <SetAsideControl athleteId={params.athleteId} groupId={params.groupId} />
          </section>
          </div>

          <div data-tab="settings">
          <section>
            <DeleteClientControl groupId={params.groupId} athleteId={params.athleteId} athleteName={profile?.full_name ?? "This client"} />
          </section>
          </div>

          <div data-tab="forms">
          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Coach notes
            </h2>
            <AthleteNotesEditor
              athleteId={params.athleteId}
              groupId={params.groupId}
              noteId={noteRow?.id ?? null}
              initialBody={noteRow?.body ?? ""}
            />
          </section>
          </div>

          <div data-tab="progress">
          {ouraConnection && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Sleep &amp; Steps
              </h2>
              <div className="space-y-4 pb-2">
                <div>
                  <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Steps</p>
                  <TrendChart points={stepsTrend} emptyLabel="No steps synced yet." />
                </div>
                <div>
                  <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                    Sleep score
                  </p>
                  <TrendChart points={sleepScoreTrend} emptyLabel="No sleep data synced yet." />
                </div>
              </div>
            </section>
          )}
          </div>

          <div data-tab="progress">
          {withingsConnection && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Weight (Withings)
              </h2>
              <p className="font-body text-xs text-steel mb-2">
                Auto-synced from a connected scale — separate from the manually-logged weight above.
              </p>
              <div className="pb-2">
                <TrendChart points={withingsWeightTrend} emptyLabel="No weight synced yet." />
              </div>
            </section>
          )}
          </div>
        </div>

        <div>
          <div data-tab="progress">
          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Progress
            </h2>
            <div className="grid grid-cols-2 gap-8 pb-6 mb-6 border-b border-steel/15">
              <div>
                <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                  Exercise
                </p>
                <Suspense fallback={<SectionLoading />}>
                  <ExerciseProgressionLoader athleteId={params.athleteId} groupId={params.groupId} />
                </Suspense>
              </div>
              <div>
                <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                  Calorie target
                </p>
                <TrendChart
                  points={calorieTrend}
                  unit=" cal"
                  emptyLabel="No calorie targets set yet."
                />
              </div>
            </div>
          </section>
          </div>

          <div data-tab="overview progress">
          <section>
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            Logged workouts
            {totalCompleted > RECENT_LOGS_LIMIT && (
              <span className="normal-case text-steel">
                {" "}
                — most recent {RECENT_LOGS_LIMIT} of {totalCompleted}
              </span>
            )}
          </h2>
          {workoutLogs.length === 0 ? (
            <p className="font-body text-sm text-steel py-2">No completed workouts yet.</p>
          ) : (
            <div className="divide-y divide-steel/15">
              {workoutLogs.map((log: any) => (
                <div key={log.id} className="py-3">
                  <Link
                    href={log.session_id ? `/sessions/${log.session_id}` : "#"}
                    className="block hover:bg-surface/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-body font-medium text-[15px] flex items-center gap-2">
                        {log.workouts?.title ?? "Workout"}
                        {log.logged_by_coach && <CoachLoggedBadge />}
                      </span>
                      <span className="font-body text-xs text-steel shrink-0">
                        {new Date(log.created_at).toLocaleDateString("en-US", { timeZone: displayZone })}
                      </span>
                    </div>
                    <p className="font-body text-xs text-steel mt-0.5">
                      {log.total_sets_completed} sets &middot;{" "}
                      {Math.round(log.total_volume ?? 0).toLocaleString()} lbs volume
                      {log.new_prs?.length > 0 && (
                        <span className="text-rust"> &middot; PR: {log.new_prs.join(", ")}</span>
                      )}
                    </p>
                  </Link>
                  {log.session_id && (
                    <Link
                      href={`/sessions/${log.session_id}/recap`}
                      className="font-body text-xs text-rust mt-1 inline-block"
                    >
                      Recap &amp; Up Next &rarr;
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
          </section>
          </div>
        </div>
      </div>

      {/* Real layout feedback from Ron: too much vertical scroll, wasted
          screen space. Wellness and the Body Weight Log are kept
          together (moved out of the long narrow left-column stack
          above), and Nutrition — previously its own full-width block at
          the very bottom of the page, after everything else — now sits
          alongside them instead, turning that wasted scroll into real
          horizontal use of the page. */}
      <div data-tab="progress" className="profile-grid border-t border-steel/20 pt-6 mt-8">
        <div className="space-y-8">
          {(wellnessRows ?? []).length > 0 && (
            <RosterSection title="Wellness" summary="Sleep, soreness & energy trends" defaultExpanded>
              <div className="space-y-4 pb-2">
                <div>
                  <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                    Sleep quality
                  </p>
                  <TrendChart
                    points={sleepQualityTrend}
                    emptyLabel="Only checked in once so far — needs a second check-in to chart a trend."
                  />
                </div>
                <div>
                  <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                    Soreness (higher = fresher)
                  </p>
                  <TrendChart
                    points={sorenessTrend}
                    emptyLabel="Only checked in once so far — needs a second check-in to chart a trend."
                  />
                </div>
                <div>
                  <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Energy</p>
                  <TrendChart
                    points={energyTrend}
                    emptyLabel="Only checked in once so far — needs a second check-in to chart a trend."
                  />
                </div>
              </div>
            </RosterSection>
          )}

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Body weight
            </h2>
            <TrendChart
              points={(weightLogs ?? [])
                .slice()
                .reverse()
                .map((w) => ({ date: w.logged_date, value: w.weight }))}
              unit=" lbs"
            />
            {weightLogs && weightLogs.length > 0 ? (
              <div className="divide-y divide-steel/15 mt-2">
                {weightLogs.map((w) => (
                  <div key={w.id} className="py-2 flex items-center justify-between">
                    <span className="font-body text-sm text-steel">
                      {new Date(w.logged_date + "T00:00:00").toLocaleDateString()}
                    </span>
                    <span className="font-body text-sm">{w.weight} lbs</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-body text-sm text-steel py-2">No weight logged yet.</p>
            )}
          </section>
        </div>
      </div>

      <div data-tab="nutrition" className="border-t border-steel/20 pt-6 mt-8">
        <Suspense fallback={<SectionLoading />}>
          {macrosEnabled ? (
            <ClientNutrition
              athleteId={params.athleteId}
              groupId={params.groupId}
              coachId={user.id}
              clientName={profile?.full_name ?? "Client"}
              variant="profile"
            />
          ) : (
            <ClientFoodLogOnly athleteId={params.athleteId} groupId={params.groupId} clientName={profile?.full_name ?? "Client"} />
          )}
        </Suspense>
      </div>
      </div>
    </CoachDesktopShell>
  );
}
