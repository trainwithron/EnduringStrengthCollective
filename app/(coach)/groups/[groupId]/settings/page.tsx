import { ChangeMyEmail } from "@/components/athlete/change-my-email";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { SignOutButton } from "@/components/group/sign-out-button";
import { EditDisplayName } from "@/components/athlete/edit-display-name";
import { PushNotificationToggle } from "@/components/athlete/push-notification-toggle";
import { SmsConsentSettings } from "@/components/athlete/sms-consent-settings";
import { isTwilioConfigured } from "@/lib/twilio";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { WearablePlaceholder } from "@/components/athlete/wearable-placeholder";
import { PackagePicker, type PackageOption } from "@/components/athlete/package-picker";
import { ManageBillingLink } from "@/components/athlete/manage-billing-link";
import { isStripeConfigured } from "@/lib/stripe";
import { ProfileDetailsEditor } from "@/components/athlete/profile-details-editor";
import { SwipeDirectionSetting } from "@/components/athlete/swipe-direction-setting";
import { HideDemosToggle } from "@/components/athlete/hide-demos-toggle";
import { TerminologyChooser } from "@/components/coach/desktop/terminology-chooser";
import { SettingsGroup } from "@/components/shared/settings-group";
import { ExportDataButton } from "@/components/athlete/export-data-button";
import { FeedBroadcastSettings } from "@/components/athlete/feed-broadcast-settings";
import { DeleteAccountButton } from "@/components/athlete/delete-account-button";
import { GamificationToggle } from "@/components/coach/gamification-toggle";
import { GoogleCalendarConnection } from "@/components/coach/google-calendar-connection";
import { ReadDuringRestToggle } from "@/components/athlete/read-during-rest-toggle";
import { ReadDuringRestSettings } from "@/components/coach/read-during-rest-settings";
import { FAITH_PACK } from "@/lib/read-content";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";

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
        .select("gamification_enabled, name")
        .eq("id", params.groupId)
        .maybeSingle(),
      supabase
        .from("athlete_sms_consent")
        .select("phone_e164, appointments, announcements, opted_out_at")
        .eq("athlete_id", athleteId)
        .maybeSingle(),
    ]);
  const isCoach = membership?.role === "coach";

  let packages: PackageOption[] = [];
  if (!isCoach) {
    const { data: packageRows } = await supabase
      .from("coach_packages")
      .select("id, name, sessions_per_week, billing_type, sessions_granted, rate_cents")
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
    }));
  }

  // Read during rest. A client's own switch is theirs alone (never read or changed while a coach is acting as them); a coach's settings are the coach's own.
  const todayKey = dateKeyInZone(await getGroupCoachTimezone(supabase, params.groupId));
  let readOn = true;
  let readDefaultOn = true;
  let readOverrides: { id: string; date: string; reference: string }[] = [];
  if (!isCoach && !effective.isActingAsOther) {
    const { data: readRow } = await supabase.from("read_settings").select("faith_track").eq("athlete_id", user.id).maybeSingle();
    readOn = readRow?.faith_track ?? true;
  } else if (isCoach && !effective.isActingAsOther) {
    const [{ data: prefRow }, { data: overrideRows }] = await Promise.all([
      supabase.from("coach_preferences").select("faith_track_default").eq("coach_id", user.id).maybeSingle(),
      supabase
        .from("read_passage_overrides")
        .select("id, override_date, reference")
        .eq("coach_id", user.id)
        .gte("override_date", todayKey)
        .order("override_date", { ascending: true })
        .limit(60),
    ]);
    readDefaultOn = (prefRow as { faith_track_default?: boolean } | null)?.faith_track_default ?? true;
    readOverrides = (overrideRows ?? []).map((r) => ({ id: r.id, date: r.override_date, reference: r.reference }));
  }

  let actingAsFullName: string | null = null;
  if (effective.isActingAsOther) {
    actingAsFullName = profile?.full_name ?? "Client";
  }

  // The coach's own blocks come first on a coach's page (their vocabulary, Read during rest, Google Calendar); a client's page starts with Notifications.
  const coachingGroup = isCoach ? (
    <SettingsGroup label="Coaching">
            <Link
              href={`/groups/${params.groupId}/dashboard`}
              className="font-body text-sm font-bold text-rust"
            >
              Your coaching workspace →
            </Link>
            <p className="font-body text-xs text-steel mt-1">
              Programs, clients, business tools — the full site.
            </p>
            <div className="mt-4 pt-4 border-t border-steel/15">
              <GamificationToggle
                groupId={params.groupId}
                initialEnabled={group?.gamification_enabled ?? true}
              />
            </div>
            <div className="mt-4 pt-4 border-t border-steel/15">
              <GoogleCalendarConnection
                groupId={params.groupId}
                connected={!!googleCalendarConnection}
                status={(googleCalendarConnection?.status as "active" | "revoked" | "error" | undefined) ?? null}
                personalEmail={googleCalendarConnection?.personal_email ?? null}
                initialError={searchParams.google_calendar_error ?? null}
              />
            </div>
            {!effective.isActingAsOther && (
              <div className="mt-4 pt-4 border-t border-steel/15">
                <ReadDuringRestSettings
                  coachId={user.id}
                  initialDefaultOn={readDefaultOn}
                  refs={FAITH_PACK.items.map((i) => i.ref)}
                  initialOverrides={readOverrides}
                  today={todayKey}
                />
              </div>
            )}
          </SettingsGroup>
  ) : null;
  const terminologyGroup = isCoach ? (
    <SettingsGroup label="What do you call your people?">
            <TerminologyChooser groupId={params.groupId} moreHref={`/groups/${params.groupId}/branding?tab=terminology`} />
          </SettingsGroup>
  ) : null;
  const notificationsGroup = (
    <SettingsGroup label="Notifications">
          <PushNotificationToggle variant="settings" profileId={user.id} audience={isCoach ? "coach" : "client"} />
        </SettingsGroup>
  );

  // A coach (not acting as a client) gets the same coach shell as every other coach page (sidebar on a desktop, the coach tabs on a phone), not the phone client page.
  const coachDesktop = isCoach && !effective.isActingAsOther;
  const page = (
    <main className={`bg-graphite text-chalk font-body ${coachDesktop ? "max-w-3xl pb-10" : "min-h-screen pb-24"}`}>
      {effective.isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        {!coachDesktop && (
          <Link
            href={`/groups/${params.groupId}`}
            className="font-body text-xs text-steel uppercase tracking-wide"
          >
            &larr; Back to group
          </Link>
        )}
        <h1 className={`font-display font-bold text-4xl leading-none uppercase ${coachDesktop ? "" : "mt-3"}`}>
          Settings
        </h1>
      </header>

      <section className="px-5 pt-6 flex items-center gap-3">
        <Avatar name={profile?.full_name ?? "?"} url={profile?.avatar_url ?? null} />
        <div className="flex-1">
          <EditDisplayName initialName={profile?.full_name ?? ""} profileId={athleteId} />
          {!effective.isActingAsOther && (
            <>
              <p className="font-body text-xs text-steel mt-0.5">{user.email}</p>
              {user.email && <ChangeMyEmail currentEmail={user.email} />}
            </>
          )}
        </div>
      </section>

      <section className="px-5 pt-8 space-y-6">
        {isCoach ? <>{coachingGroup}{terminologyGroup}{notificationsGroup}</> : notificationsGroup}

        <SettingsGroup label="Profile">
          {!isCoach && !effective.isActingAsOther && (
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

        <SettingsGroup label="Text messages & devices">
          {/* Consent is the person's own to give, so it is never shown (or
              writable) while a coach is acting as them. */}
          {!isCoach && !effective.isActingAsOther && isTwilioConfigured() && (
            <div className="py-4 border-b border-steel/20">
              <SmsConsentSettings
                initialPhone={smsConsent?.phone_e164 ?? profileDetails?.phone ?? ""}
                initialAppointments={smsConsent?.appointments ?? false}
                initialAnnouncements={smsConsent?.announcements ?? false}
                optedOut={!!smsConsent?.opted_out_at}
              />
            </div>
          )}
          <div className="pt-4">
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
          <SettingsGroup label="Workout Logging">
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
        {!isCoach && (membership as { client_tier?: string | null } | null)?.client_tier !== "one_on_one" && (
          <SettingsGroup label="Sharing to the group feed">
            <FeedBroadcastSettings
              profileId={athleteId}
              initialLevel={((profile as { feed_broadcast_level?: string } | null)?.feed_broadcast_level as "full" | "prs_only" | "checkin_only" | "private" | undefined) ?? "full"}
            />
          </SettingsGroup>
        )}

        <SettingsGroup label="Feedback">
          <FeedbackButton />
        </SettingsGroup>

        {/* Hidden until payments are set up in the app: today the coach collects payment outside it. */}
        {!isCoach && isStripeConfigured() && (
          <SettingsGroup label="Billing">
            <PackagePicker packages={packages} />
            <div className="mt-3">
              <ManageBillingLink />
            </div>
          </SettingsGroup>
        )}

        <SettingsGroup label="More">
          <Link href={`/groups/${params.groupId}/more`} className="block font-body text-sm text-chalk">
            Goals, tools, photos, messages and community →
          </Link>
        </SettingsGroup>

        {!isCoach && !effective.isActingAsOther && (
          <SettingsGroup label="Your Data">
            <div className="space-y-3">
              <ExportDataButton />
              <DeleteAccountButton />
            </div>
          </SettingsGroup>
        )}

        <div className="pt-2 pb-4">
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

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />;
  }
  return (
    <div className="w-14 h-14 rounded-full bg-surface border border-steel/30 flex items-center justify-center shrink-0">
      <span className="font-display text-lg">{initials}</span>
    </div>
  );
}
