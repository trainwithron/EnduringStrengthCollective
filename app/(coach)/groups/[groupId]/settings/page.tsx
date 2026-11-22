import { ChangeMyEmail } from "@/components/athlete/change-my-email";
import { LeaveOrganizationControl } from "@/components/org/leave-organization-control";
import { CalendarFeedLink } from "@/components/coach/calendar-feed-link";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { orgIdOfGroup } from "@/lib/org-of-group";
import { loadTeamInfo } from "@/lib/org-team";
import { readStayingMembers } from "@/lib/org-members";
import { CoachTypeSetting } from "@/components/coach/coach-type-setting";
import { NotificationSettings } from "@/components/shared/notification-settings";
import { isCoachType, type CoachType } from "@/lib/coach-type";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createCrossOrgServerClient, createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ActingAsBanner } from "@/components/athlete/acting-as-bar";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { SignOutButton } from "@/components/group/sign-out-button";
import { TabletLayoutSwitch } from "@/components/coach/tablet-layout-switch";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";
import { BlockedMembersList, type BlockedMember } from "@/components/feed/blocked-members-list";
import { loadBlockedIds } from "@/lib/blocked-members";
import { EditDisplayName } from "@/components/athlete/edit-display-name";
import { SmsConsentSettings } from "@/components/athlete/sms-consent-settings";
import { isTwilioConfigured } from "@/lib/twilio";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { WearablePlaceholder } from "@/components/athlete/wearable-placeholder";
import { PackagePicker, type PackageOption } from "@/components/athlete/package-picker";
import { ManageBillingLink } from "@/components/athlete/manage-billing-link";
import { isStripeConfigured } from "@/lib/stripe";
import { payeeReadyForGroup } from "@/lib/connect-payee";
import { ProfileDetailsEditor } from "@/components/athlete/profile-details-editor";
import { InstagramHandleField } from "@/components/coach/instagram-handle-field";
import { readInstagramHandle } from "@/lib/instagram-handle";
import { readMyPageQr, TURN_ON_PAGE_TEXT } from "@/lib/my-page-qr";
import { myPagePoster } from "@/lib/qr-poster";
import { QrPosterButton } from "@/components/coach/qr-poster-button";
import { SwipeDirectionSetting } from "@/components/athlete/swipe-direction-setting";
import { HideDemosToggle } from "@/components/athlete/hide-demos-toggle";
import { SettingsGroup } from "@/components/shared/settings-group";
import { ExportDataButton } from "@/components/athlete/export-data-button";
import { FeedBroadcastSettings } from "@/components/athlete/feed-broadcast-settings";
import { SharedGroupSettings } from "@/components/athlete/shared-group-settings";
import { loadMySharedGroups } from "@/lib/shared-group-join";
import { resolveShowName } from "@/lib/share-name";
import { ageStatusFromDob } from "@/lib/youth-block";
import { ShowNameOnShareToggle } from "@/components/athlete/show-name-on-share-toggle";
import { DeleteAccountButton } from "@/components/athlete/delete-account-button";
import { GamificationToggle } from "@/components/coach/gamification-toggle";
import { PostWorkoutCardsToggle } from "@/components/coach/post-workout-cards-toggle";
import { loadPostWorkoutCards } from "@/lib/post-workout-cards";
import { TeamSportToggle } from "@/components/coach/team-sport-toggle";
import { GoogleCalendarConnection } from "@/components/coach/google-calendar-connection";
import { ReadDuringRestToggle } from "@/components/athlete/read-during-rest-toggle";
import { ReadDuringRestSettings } from "@/components/coach/read-during-rest-settings";
import { FAITH_PACK } from "@/lib/read-content";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { SuggestionSettingsWhereNoAvailability, type SuggestionPrefs } from "@/components/coach/desktop/suggestion-settings-no-availability";
import { isTeamSportGroup, moneyHiddenFor, orgIsTeamOnly } from "@/lib/team-sport";

export const metadata = { title: "Settings" };

export default async function SettingsPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{
      oura_error?: string;
      withings_error?: string;
      garmin_error?: string;
      google_health_error?: string;
      google_calendar_error?: string;
    }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
  // The members this person has blocked in the group feed (Settings is where a block is undone).
  const blockedIds = await loadBlockedIds(supabase);
  const { data: blockedPeople } = blockedIds.length > 0 ? await supabase.from("profiles").select("id, full_name").in("id", blockedIds) : { data: [] };
  const blockedMembers: BlockedMember[] = ((blockedPeople ?? []) as { id: string; full_name: string | null }[]).map((p) => ({ id: p.id, name: p.full_name ?? "A member" }));
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // A coach "acting as" a client sees that client's real Settings page —
  // their own profile, billing, and account controls — exactly what QA'ing
  // "does it look right on their end" requires. Deriving isCoach from the
  // effective athlete (not the real signed-in user) naturally reads as
  // false while impersonating an athlete, without any special-casing below.
  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const athleteId = effective.athleteId;

  const [
    { data: profile },
    { data: membership },
    { data: ouraConnection },
    { data: withingsConnection },
    { data: garminConnection },
    { data: googleHealthConnection },
    { data: googleCalendarConnection },
    { data: profileDetails },
    { data: group },
    { data: smsConsent },
  ] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, avatar_url, exercise_swipe_direction, feed_broadcast_level")
        .eq("id", athleteId)
        .single(),
      supabase
        .from("group_memberships")
        .select("role, history_import_enabled, client_tier")
        .eq("group_id", params.groupId)
        .eq("profile_id", athleteId)
        .maybeSingle(),
      supabase
        .from("wearable_connections")
        .select("status")
        .eq("profile_id", athleteId)
        .eq("provider", "oura")
        .maybeSingle(),
      supabase
        .from("wearable_connections")
        .select("status")
        .eq("profile_id", athleteId)
        .eq("provider", "withings")
        .maybeSingle(),
      supabase
        .from("wearable_connections")
        .select("status")
        .eq("profile_id", athleteId)
        .eq("provider", "garmin")
        .maybeSingle(),
      supabase
        .from("wearable_connections")
        .select("status")
        .eq("profile_id", athleteId)
        .eq("provider", "google_health")
        .maybeSingle(),
      supabase
        .from("google_calendar_connections")
        .select("status, personal_email")
        .eq("coach_id", athleteId)
        .maybeSingle(),
      supabase
        .from("athlete_profile_details")
        .select("bio, birthday, phone, emergency_contact_name, emergency_contact_phone")
        .eq("athlete_id", athleteId)
        .maybeSingle(),
      supabase
        .from("groups")
        .select("gamification_enabled, name, group_kind, team_mode, organization_id")
        .eq("id", params.groupId)
        .maybeSingle(),
      supabase
        .from("athlete_sms_consent")
        .select("phone_e164, appointments, announcements, opted_out_at")
        .eq("athlete_id", athleteId)
        .maybeSingle(),
    ]);
  const isCoach = membership?.role === "coach";

  // A member who is not the owner can leave the organization this group is in.
  let leaveInfo: { id: string; name: string; others: { id: string; name: string }[]; soleClients: number; unknown: boolean } | null = null;
  if (isCoach) {
    const orgIdForLeave = await orgIdOfGroup(supabase, params.groupId);
    if (orgIdForLeave) {
      const [{ data: orgRow }, { data: memberRow }] = await Promise.all([
        supabase.from("organizations").select("name, owner_id").eq("id", orgIdForLeave).maybeSingle(),
        supabase.from("organization_memberships").select("id").eq("organization_id", orgIdForLeave).eq("profile_id", user.id).maybeSingle(),
      ]);
      // A coach who is already leaving has no "Leave" to press: their Home offers the two choices. (A separate read: a database without the column yet just shows nobody as leaving.)
      const { data: leavingRow } = await supabase.from("organization_memberships").select("departing_since").eq("organization_id", orgIdForLeave).eq("profile_id", user.id).not("departing_since", "is", null).maybeSingle();
      if (orgRow && memberRow && !leavingRow && orgRow.owner_id !== user.id) {
        // Who could take over my clients, and how many clients only I coach (so Leave can ask first).
        const [{ data: others }, team] = await Promise.all([
          readStayingMembers((x) => {
            const q = supabase.from("organization_memberships").select("profile_id, profiles ( full_name )").eq("organization_id", orgIdForLeave).neq("profile_id", user.id);
            return x ? q.is("departing_since", null) : q;
          }),
          loadTeamInfo(supabase, orgIdForLeave),
        ]);
        leaveInfo = {
          id: orgIdForLeave,
          name: orgRow.name as string,
          others: ((others ?? []) as any[]).map((o) => ({ id: o.profile_id as string, name: (o.profiles as { full_name?: string } | null)?.full_name ?? "Coach" })),
          soleClients: team.soleCoachOfClients[user.id] ?? 0,
          // a failed read of the organization's groups must not look like "no clients to hand over"
          unknown: team.failed,
        };
      }
    }
  }
  // Organization colors, logo and fonts (Ron, Oct 19: "where I customize my organization colors and all of that stuff"): a link for a coach who can edit them, the same check as the branding page (a coach here, and owner or admin of this group's organization). Branding is a computer page, so not on the phone.
  let canEditBranding = false;
  if (isCoach && !effective.isActingAsOther && !(await prefersAthleteStyleView())) {
    const orgIdForLook = await orgIdOfGroup(supabase, params.groupId);
    if (orgIdForLook) {
      const { data: lookRow } = await supabase.from("organization_memberships").select("role").eq("organization_id", orgIdForLook).eq("profile_id", user.id).maybeSingle();
      canEditBranding = lookRow?.role === "owner" || lookRow?.role === "admin";
    }
  }
  // A client who trains in more than one space (two coaches) gets a link to pick between them.
  let trainsWithSeveralCoaches = false;
  if (!isCoach && !effective.isActingAsOther) {
    // A seat in a shared group (joined from Home, social-only) is not a second coach.
    const { count: spaceCount } = await (await createCrossOrgServerClient()).from("group_memberships").select("id", { count: "exact", head: true }).eq("profile_id", user.id).eq("role", "athlete").eq("membership_type", "training");
    trainsWithSeveralCoaches = (spaceCount ?? 0) > 1;
  }
  // The organization's shared group this one-on-one client joined from Home (step 202): share my workouts on/off, and leave. Empty before that step.
  const mySharedGroups =
    !isCoach && !effective.isActingAsOther && (group as { group_kind?: string } | null)?.group_kind === "one_on_one"
      ? await loadMySharedGroups(supabase, user.id, (group as { organization_id?: string | null } | null)?.organization_id ?? null)
      : [];
  // On an organization's front desk (0400): a link to the check-in screen for people who land somewhere else. Read on its own, so a database without the table yet just shows no link.
  const { data: deskRows } = await supabase.from("org_front_desk").select("organization_id").eq("profile_id", user.id).limit(1);
  const onFrontDesk = (deskRows ?? []).length > 0;
  // Quiet hours and private lock screens (0395). Read on its own so a database without the columns yet shows the whole page (the two choices are then left out).
  const pushPrefsRead = await supabase.from("profiles").select("quiet_hours_start, quiet_hours_end, generic_push_text").eq("id", user.id).maybeSingle();
  // The kinds of notice this coach switched off (profiles.notices_off, migration 0423). Until it is applied the read fails and the switches are simply not shown.
  const noticesRead = await supabase.from("profiles").select("notices_off").eq("id", user.id).maybeSingle();
  const noticesOff: string[] | null = noticesRead.error ? null : ((noticesRead.data as { notices_off?: string[] | null } | null)?.notices_off ?? []);
  const pushPrefs = pushPrefsRead.error ? null : (pushPrefsRead.data as { quiet_hours_start: number | null; quiet_hours_end: number | null; generic_push_text: boolean | null } | null);
  // What this coach coaches (0392). Read on its own so a database that does not have the column yet still shows the whole page.
  let coachTypeNow: CoachType | null = null;
  if (isCoach) {
    const typeRead = await supabase.from("profiles").select("coach_type").eq("id", user.id).maybeSingle();
    const value = (typeRead.data as { coach_type?: string | null } | null)?.coach_type;
    coachTypeNow = !typeRead.error && isCoachType(value) ? value : null;
  }
  // The first-name-on-shared-pictures switch (0334). Read on its own so a database that does not have the column yet still shows the whole page (the switch is just left out).
  const shareNameRead = await supabase.from("profiles").select("show_name_on_share").eq("id", athleteId).maybeSingle();
  // The platform admin's own tools, in an Admin fold at the bottom (PH16, Nov 21: they sat in Spotlight's Business tile). A failed read shows no fold.
  const adminRead = isCoach ? await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle() : null;
  const isPlatformAdmin = (adminRead?.data as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;
  const showNameAvailable = !shareNameRead.error;
  // With no choice made yet the box shows what the default is for them: off under 18, on for an adult or when no date of birth is on file.
  const ownDob = shareNameRead.error ? null : ((await supabase.from("client_intake").select("date_of_birth").eq("athlete_id", athleteId).maybeSingle()).data as { date_of_birth?: string | null } | null)?.date_of_birth ?? null;
  const showNameOn = resolveShowName((shareNameRead.data as { show_name_on_share?: boolean | null } | null)?.show_name_on_share, ownDob);

  let packages: PackageOption[] = [];
  if (!isCoach) {
    const { data: packageRows } = await supabase
      .from("coach_packages")
      .select("id, name, sessions_per_week, billing_type, sessions_granted, rate_cents, price_cents")
      .eq("group_id", params.groupId)
      .eq("is_active", true)
      .order("sessions_per_week", { ascending: true });
    packages = (packageRows ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      sessionsPerWeek: p.sessions_per_week,
      billingType: p.billing_type as "subscription" | "one_time",
      sessionsGranted: p.sessions_granted,
      rateCents: p.rate_cents,
      priceCents: p.price_cents ?? null,
    }));
    // Buy buttons only when the coach's own Stripe can take the payment.
    if (packages.length > 0 && isStripeConfigured() && !(await payeeReadyForGroup(params.groupId))) packages = [];
  }

  // Read during rest. A client's own switch is theirs alone (never read or changed while a coach is acting as them); a coach's settings are the coach's own.
  const todayKey = dateKeyInZone(await getGroupCoachTimezone(supabase, params.groupId));
  let readOn = true;
  let readDefaultOn = true;
  let readOverrides: { id: string; date: string; reference: string }[] = [];
  let ownPassages: { id: string; reference: string; text: string }[] | null = null;
  if (!isCoach && !effective.isActingAsOther) {
    const { data: readRow } = await supabase.from("read_settings").select("faith_track").eq("athlete_id", user.id).maybeSingle();
    readOn = readRow?.faith_track ?? true;
  } else if (isCoach && !effective.isActingAsOther) {
    const [{ data: prefRow }, { data: overrideRows }, ownRead] = await Promise.all([
      supabase.from("coach_preferences").select("faith_track_default").eq("coach_id", user.id).maybeSingle(),
      supabase
        .from("read_passage_overrides")
        .select("id, override_date, reference")
        .eq("coach_id", user.id)
        .gte("override_date", todayKey)
        .order("override_date", { ascending: true })
        .limit(60),
      // His own passages (0431); before that step the read fails and Add a passage is not shown.
      supabase.from("coach_read_passages").select("id, reference, text").eq("coach_id", user.id).order("created_at", { ascending: true }).limit(500),
    ]);
    ownPassages = ownRead.error ? null : ((ownRead.data ?? []) as { id: string; reference: string; text: string }[]);
    readDefaultOn = (prefRow as { faith_track_default?: boolean } | null)?.faith_track_default ?? true;
    readOverrides = (overrideRows ?? []).map((r) => ({ id: r.id, date: r.override_date, reference: r.reference }));
  }

  let actingAsFullName: string | null = null;
  if (effective.isActingAsOther) {
    actingAsFullName = profile?.full_name ?? "Client";
  }

  // What this group does after a workout now: its own choice, or the default (off for a team-sport group, on otherwise). Read apart from the group row so a database without the column still loads the page.
  const postWorkoutCards = isCoach ? await loadPostWorkoutCards(supabase, params.groupId) : true;
  // The coach's own blocks come first on a coach's page (their vocabulary, Read during rest, Google Calendar); a client's page starts with Notifications.
  // The coach's own personal space (their own client app) belongs to no organization: the vocabulary below is an ORGANIZATION's setting (it would be saved into some organization the coach owns, arbitrarily), and "Your coaching
  // workspace" has to open the coach's Home, not the empty workspace of this personal space (Oct 19 audit).
  const inPersonalSpace = effective.isActingAsOther && (group as { organization_id?: string | null } | null)?.organization_id == null;
  // Looking at SOMEONE ELSE (a coach acting as a client). In their own space the coach is themself (Release 2: the phone opens as the coach's own account), so their own settings show.
  const viewingOther = effective.isActingAsOther && athleteId !== user.id;
  // A coach's own Instagram handle, for their clients' share pictures (Ron, Oct 27: "a place to input ig handle individually", on the computer and the phone): every coach, with or without
  // a public page, sets only their own. Before the database update that adds it the read fails and the field is not shown.
  const igHandle = isCoach && !viewingOther ? await readInstagramHandle(supabase, user.id) : null;
  // Beside it, "My page QR code" for a poster that opens the coach's public page (Oct 27): the code while the page is on and published, else where to turn it on. Nothing is switched on here.
  const myPageQr = isCoach && !viewingOther ? await readMyPageQr(supabase, user.id, params.groupId) : null;
  // Suggestion settings for a coach who has no Availability tab (clutter audit DK11 review, Nov 21): the same coach_preferences read as Availability. Where the money tabs are
  // hidden (a team-sport group, a team-only organization) they always show; for a team coach the block itself checks the menus' rule. A failed read shows nothing.
  let suggestionPrefs: SuggestionPrefs | null = null;
  let suggestionForce = false;
  if (isCoach && !viewingOther) {
    const orgId = (group as { organization_id?: string | null } | null)?.organization_id ?? null;
    const [prefsRead, orgGroupsRead] = await Promise.all([
      supabase.from("coach_preferences").select("suggestion_mode, suggestion_lead_days, suggestion_lead_mode, suggestion_lead_weekday").eq("coach_id", user.id).maybeSingle(),
      orgId ? supabase.from("groups").select("team_mode").eq("organization_id", orgId).limit(500) : Promise.resolve({ data: [] as { team_mode: boolean | null }[], error: null }),
    ]);
    if (!prefsRead.error) suggestionPrefs = (prefsRead.data as SuggestionPrefs | null) ?? {};
    const orgTeamOnly = !orgGroupsRead.error && orgIsTeamOnly((orgGroupsRead.data ?? []) as { team_mode?: boolean | null }[]);
    suggestionForce = moneyHiddenFor({ coachLevel: false, groupIsTeamSport: isTeamSportGroup((group as { team_mode?: boolean | null } | null)?.team_mode), orgTeamOnly });
  }
  const coachingGroup = isCoach ? (
    <SettingsGroup label="Coaching">
            {/* In their own space the phone IS their app (Release 2): the layout switch (tablets only) and the app download. No "Coach home" link anywhere: the group dashboard is out of the navigation (clutter audit DK11, Nov 21). */}
            {inPersonalSpace && (
              <div className="space-y-2">
                <TabletLayoutSwitch to="desktop" />
                <DownloadAppButton />
              </div>
            )}
            {suggestionPrefs && <SuggestionSettingsWhereNoAvailability coachId={user.id} force={suggestionForce} prefs={suggestionPrefs} />}
            <div className="mt-4 pt-4 border-t border-steel/15">
              <GoogleCalendarConnection
                groupId={params.groupId}
                connected={!!googleCalendarConnection}
                status={(googleCalendarConnection?.status as "active" | "revoked" | "error" | undefined) ?? null}
                personalEmail={googleCalendarConnection?.personal_email ?? null}
                initialError={searchParams.google_calendar_error ?? null}
              />
              {/* Apple, Outlook or any calendar app: a private read-only link (wave 3 C8) */}
              <CalendarFeedLink />
            </div>
            {!viewingOther && (
              <div className="mt-4 pt-4 border-t border-steel/15">
                <ReadDuringRestSettings
                  coachId={user.id}
                  initialDefaultOn={readDefaultOn}
                  refs={FAITH_PACK.items.map((i) => i.ref)}
                  initialOverrides={readOverrides}
                  today={todayKey}
                  initialOwn={ownPassages}
                />
              </div>
            )}
            {/* These three change only this group: it is named, so a switch is never flipped on the wrong group without knowing (DK16, Nov 21). */}
            <p className="mt-4 pt-4 border-t border-steel/15 font-body text-xs text-steel uppercase tracking-wide" data-group-switches>
              For {(group as { name?: string } | null)?.name ?? "this group"} only
            </p>
            {(group as { group_kind?: string } | null)?.group_kind !== "one_on_one" && (
              <div className="mt-3">
                <TeamSportToggle groupId={params.groupId} initialEnabled={(group as { team_mode?: boolean | null } | null)?.team_mode === true} />
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-steel/15">
              <PostWorkoutCardsToggle groupId={params.groupId} initialEnabled={postWorkoutCards} />
            </div>
            <div className="mt-4 pt-4 border-t border-steel/15">
              <GamificationToggle
                groupId={params.groupId}
                initialEnabled={group?.gamification_enabled ?? true}
              />
            </div>
          </SettingsGroup>
  ) : null;
  const terminologyGroup = isCoach && !inPersonalSpace ? (
    // One place for it: Organization > Labels (DK14, Nov 21; it was set here, there and on Home).
    <SettingsGroup label="What do you call your people?">
      <Link href={`/groups/${params.groupId}/branding?tab=labels`} className="font-body text-sm font-bold text-rust-ink inline-flex items-center min-h-11" data-settings-labels>
        Clients, athletes, members: set it in Organization &gt; Labels →
      </Link>
    </SettingsGroup>
  ) : null;
  const notificationsGroup = (
    <SettingsGroup label="Notifications">
          {/* One row, closed until tapped (Ron, Oct 21: "Needs to be collapsible. That's way too big."). */}
          <NotificationSettings
            profileId={user.id}
            audience={isCoach ? "coach" : "client"}
            pushPrefs={pushPrefs}
            notices={isCoach && !viewingOther && noticesOff !== null ? { initialOff: noticesOff } : null}
          />
        </SettingsGroup>
  );

  // A coach (not acting as a client) gets the same coach shell as every other coach page (sidebar on a desktop, the coach tabs on a phone), not the phone client page.
  const coachDesktop = isCoach && !effective.isActingAsOther;
  // More is the client's page: on a client's settings, and a coach's in their own space or looking as a client; not on a coach's own settings (DK16).
  const showMore = !isCoach || effective.isActingAsOther;
  const page = (
    <main className={`bg-graphite text-chalk font-body ${coachDesktop ? "max-w-3xl @3xl:max-w-6xl pb-10" : "min-h-screen pb-24"}`}>
      {effective.isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      {/* (CL21, Nov 21: no "← Home" here; Settings is a tab of the bar at the bottom) */}
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <h1 className="font-display font-bold text-3xl leading-none uppercase">
          Settings
        </h1>
      </header>

      <section className="px-5 pt-6 flex items-center gap-3">
        <div className="flex-1">
          <EditDisplayName initialName={profile?.full_name ?? ""} profileId={athleteId} />
          {!viewingOther && (
            <>
              <p className="font-body text-xs text-steel mt-0.5">{user.email}</p>
              {user.email && <ChangeMyEmail currentEmail={user.email} />}
            </>
          )}
        </div>
      </section>
      {(igHandle || myPageQr) && (
        <section className="px-5 pt-4 max-w-md space-y-4" data-settings-instagram>
          {igHandle && <InstagramHandleField coachId={user.id} initialHandle={igHandle.handle} id="settings-instagram-handle" />}
          {myPageQr && (
            <div data-my-page-qr>
              <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">My page QR code</p>
              {myPageQr.kind === "ready" ? (
                <QrPosterButton url={myPageQr.url} content={myPagePoster(profile?.full_name, igHandle?.handle)} label="My page QR code" />
              ) : (
                <Link href={myPageQr.href} className="min-h-11 px-3 inline-flex items-center border border-steel/40 text-chalk font-body text-sm">
                  {TURN_ON_PAGE_TEXT}
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      {/* Progress, goal, the weekly check-in, messages and photos, right under the name (CL2, Nov 21: the More row was last on the page). Not on a coach's own settings
          (DK16: More is the client's page). */}
      {showMore && (
        <section className="px-5 pt-5" data-settings-more>
          <Link href={`/groups/${params.groupId}/more`} className="flex items-center justify-between min-h-14 bg-surface rounded-card px-4 py-2">
            <span>
              <span className="block font-body text-[15px] font-semibold text-chalk">More</span>
              <span className="block font-body text-xs text-steel">My progress, goal, weekly check-in, messages and photos</span>
            </span>
            <span aria-hidden="true" className="text-steel">&rarr;</span>
          </Link>
        </section>
      )}

      {/* With room (a coach's page area, @3xl), the groups flow in two balanced columns; help, feedback, more and sign out sit in one row underneath. On a phone and for a client, one column as before. */}
      <section className="px-5 pt-8 space-y-6 @3xl:space-y-0 @3xl:columns-2 @3xl:gap-10 [&>*]:break-inside-avoid @3xl:[&>*]:mb-6">
        {isCoach ? <>{coachingGroup}{terminologyGroup}{notificationsGroup}</> : notificationsGroup}

        {isCoach && !viewingOther && (
          <SettingsGroup label="What you coach">
            <CoachTypeSetting profileId={user.id} initial={coachTypeNow} />
          </SettingsGroup>
        )}

        {isCoach && !effective.isActingAsOther && (
          // One way in (DK15, Nov 21): coaches and invitations live on Organization > Team.
          <SettingsGroup label="Coaches and invitations">
            <Link href={`/groups/${params.groupId}/branding?tab=team`} className="font-body text-sm font-bold text-rust-ink inline-flex items-center min-h-11" data-settings-team>
              Your coaches and invitations →
            </Link>
          </SettingsGroup>
        )}

        {canEditBranding && (
          <SettingsGroup label="Organization look">
            <Link href={`/groups/${params.groupId}/branding?tab=branding`} className="font-body text-sm font-bold text-rust-ink" data-organization-look>
              Colors, logo and fonts →
            </Link>
          </SettingsGroup>
        )}

        {isCoach && leaveInfo && (
          <SettingsGroup label="Organization">
            <LeaveOrganizationControl organizationId={leaveInfo.id} organizationName={leaveInfo.name} others={leaveInfo.others} soleClients={leaveInfo.soleClients} unknown={leaveInfo.unknown} />
          </SettingsGroup>
        )}

        {trainsWithSeveralCoaches && (
          <SettingsGroup label="Your coaches">
            <Link href="/your-coaches" className="block py-3 font-body text-sm text-chalk">
              You train with more than one coach. Switch between them &rarr;
            </Link>
          </SettingsGroup>
        )}

        <SettingsGroup label="Profile">
          {((!isCoach && !effective.isActingAsOther) || inPersonalSpace) && (
            <Link href={`/groups/${params.groupId}/about-you`} className="block py-3 border-b border-steel/20 font-body text-sm text-chalk">
              About you: height, weight, activity and units &rarr;
            </Link>
          )}
          <ProfileDetailsEditor
            showEmergencyContact={!isCoach}
            athleteId={athleteId}
            initial={{
              bio: profileDetails?.bio ?? "",
              birthday: profileDetails?.birthday ?? "",
              phone: profileDetails?.phone ?? "",
              emergencyContactName: profileDetails?.emergency_contact_name ?? "",
              emergencyContactPhone: profileDetails?.emergency_contact_phone ?? "",
            }}
          />
        </SettingsGroup>

        {/* Consent is the person's own to give, so it is never shown (or writable) while a coach is acting as them. Its own group now, and the number comes from Profile
            (CL23, Nov 21: wearables were filed under "Text messages"). */}
        {!isCoach && !effective.isActingAsOther && isTwilioConfigured() && (
          <SettingsGroup label="Text messages">
            <SmsConsentSettings
              initialPhone={smsConsent?.phone_e164 ?? profileDetails?.phone ?? ""}
              initialAppointments={smsConsent?.appointments ?? false}
              initialAnnouncements={smsConsent?.announcements ?? false}
              optedOut={!!smsConsent?.opted_out_at}
            />
          </SettingsGroup>
        )}

        <SettingsGroup label="Devices">
          <div>
            <WearablePlaceholder
              groupId={params.groupId}
              ouraConnected={!!ouraConnection}
              ouraStatus={(ouraConnection?.status as "active" | "revoked" | "error" | undefined) ?? null}
              ouraError={searchParams.oura_error ?? null}
              withingsConnected={!!withingsConnection}
              withingsStatus={(withingsConnection?.status as "active" | "revoked" | "error" | undefined) ?? null}
              withingsError={searchParams.withings_error ?? null}
              garminConnected={!!garminConnection}
              garminStatus={(garminConnection?.status as "active" | "revoked" | "error" | undefined) ?? null}
              garminError={searchParams.garmin_error ?? null}
              googleHealthConnected={!!googleHealthConnection}
              googleHealthStatus={(googleHealthConnection?.status as "active" | "revoked" | "error" | undefined) ?? null}
              googleHealthError={searchParams.google_health_error ?? null}
            />
          </div>
        </SettingsGroup>

        {!isCoach && (
          <SettingsGroup label="Workout logging">
            <SwipeDirectionSetting
              athleteId={athleteId}
              label="Swipe direction"
              initialDirection={
                (profile?.exercise_swipe_direction as "vertical" | "horizontal" | null) ?? null
              }
            />
            <div className="mt-4">
              <HideDemosToggle />
            </div>
            {!effective.isActingAsOther && (
              <div className="mt-4">
                <ReadDuringRestToggle athleteId={user.id} initialOn={readOn} />
              </div>
            )}
          </SettingsGroup>
        )}

        {/* A group member's workouts post to the group feed by default (accountability); this is the clear way to turn that off. A one-on-one client has no feed, so no control. */}
        {!isCoach && (membership as { client_tier?: string | null } | null)?.client_tier !== "one_on_one" && (group as { group_kind?: string } | null)?.group_kind !== "one_on_one" && (
          <SettingsGroup label="Sharing to the group feed">
            <FeedBroadcastSettings
              profileId={athleteId}
              initialLevel={((profile as { feed_broadcast_level?: string } | null)?.feed_broadcast_level as "full" | "prs_only" | "checkin_only" | "private" | undefined) ?? "full"}
            />
          </SettingsGroup>
        )}

        {mySharedGroups.map((g) => (
          <SettingsGroup key={g.groupId} label="Your group">
            <SharedGroupSettings groupId={g.groupId} groupName={g.groupName} initialShares={g.sharesWorkouts} allowShare={g.allowShare} />
          </SettingsGroup>
        ))}

        {!isCoach && showNameAvailable && ageStatusFromDob(ownDob) === "adult" && (
          <SettingsGroup label="Sharing your workout picture">
            <ShowNameOnShareToggle profileId={athleteId} initialOn={showNameOn} />
          </SettingsGroup>
        )}

        {blockedMembers.length > 0 && (
          <SettingsGroup label="Blocked members">
            <BlockedMembersList initial={blockedMembers} />
          </SettingsGroup>
        )}
      </section>

      <section className="px-5 pt-6 space-y-6 @3xl:space-y-0 @3xl:flex @3xl:flex-wrap @3xl:items-start @3xl:gap-x-12 @3xl:gap-y-4 @3xl:mx-5 @3xl:px-0 @3xl:mt-2 @3xl:border-t @3xl:border-steel/20">
        <SettingsGroup label="Help">
          <Link href="/help" className="min-h-11 inline-flex items-center font-body text-sm text-chalk">
            Help articles, what&apos;s new and app status →
          </Link>
        </SettingsGroup>

        <SettingsGroup label="Feedback">
          <FeedbackButton />
        </SettingsGroup>

        {/* Hidden until payments are set up in the app: today the coach collects payment outside it. */}
        {!isCoach && isStripeConfigured() && (
          <SettingsGroup label="Billing">
            <PackagePicker packages={packages} />
            <div className="mt-3">
              <ManageBillingLink groupId={params.groupId} />
            </div>
          </SettingsGroup>
        )}


        {!isCoach && !effective.isActingAsOther && (
          <SettingsGroup label="Your Data">
            <div className="space-y-3">
              <ExportDataButton />
              <DeleteAccountButton />
            </div>
          </SettingsGroup>
        )}

        {onFrontDesk && (
          <p className="font-body text-sm pt-2">
            <Link href="/front-desk" className="text-rust-ink">
              Open the front desk check-in screen →
            </Link>
          </p>
        )}

        {isPlatformAdmin && !effective.isActingAsOther && (
          <details className="border-t border-steel/20 pt-2" data-settings-admin>
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden min-h-11 flex items-center font-body text-xs text-steel uppercase tracking-wide">Admin</summary>
            <div className="flex flex-col pb-2">
              {[
                ["Support inbox", "/admin/support"],
                ["Organizations", "/admin/organizations"],
                ["Machine requests", "/admin/machine-catalog"],
                ["Recipe ingredients", "/admin/nutrition-ingredients"],
              ].map(([label, href]) => (
                <Link key={href} href={href} className="min-h-11 inline-flex items-center font-body text-sm text-chalk">
                  {label} &rarr;
                </Link>
              ))}
            </div>
          </details>
        )}

        <div className="pt-2 pb-4 @3xl:pt-0 @3xl:self-center">
          <SignOutButton />
        </div>
      </section>

      {/* A coach's tabs and Spotlight button come from the coach shell around this page; the client tab bar is for clients. */}
      {!coachDesktop && <BottomTabBar groupId={params.groupId} activeOverride="settings" />}
    </main>
  );

  return coachDesktop ? (
    <CoachDesktopShell groupId={params.groupId} groupName={(group as { name?: string } | null)?.name ?? "Coaching"} active="settings">
      {page}
    </CoachDesktopShell>
  ) : (
    page
  );
}
