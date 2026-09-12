import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { SignOutButton } from "@/components/group/sign-out-button";
import { EditDisplayName } from "@/components/athlete/edit-display-name";
import { PushNotificationToggle } from "@/components/athlete/push-notification-toggle";
import { WearablePlaceholder } from "@/components/athlete/wearable-placeholder";
import { PackagePicker, type PackageOption } from "@/components/athlete/package-picker";
import { ManageBillingLink } from "@/components/athlete/manage-billing-link";
import { ProfileDetailsEditor } from "@/components/athlete/profile-details-editor";
import { ExportDataButton } from "@/components/athlete/export-data-button";
import { DeleteAccountButton } from "@/components/athlete/delete-account-button";
import { GamificationToggle } from "@/components/coach/gamification-toggle";

export default async function SettingsPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ oura_error?: string }>;
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

  const [{ data: profile }, { data: membership }, { data: ouraConnection }, { data: profileDetails }, { data: group }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", athleteId)
        .single(),
      supabase
        .from("group_memberships")
        .select("role")
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
        .from("athlete_profile_details")
        .select("bio, birthday, phone, emergency_contact_name, emergency_contact_phone")
        .eq("athlete_id", athleteId)
        .maybeSingle(),
      supabase
        .from("groups")
        .select("gamification_enabled")
        .eq("id", params.groupId)
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

  let actingAsFullName: string | null = null;
  if (effective.isActingAsOther) {
    actingAsFullName = profile?.full_name ?? "Client";
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      {effective.isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to group
        </Link>
        <h1 className="font-display font-bold text-4xl leading-none mt-3 uppercase">
          Settings
        </h1>
      </header>

      <section className="px-5 pt-6 flex items-center gap-3">
        <Avatar name={profile?.full_name ?? "?"} url={profile?.avatar_url ?? null} />
        <div className="flex-1">
          <EditDisplayName initialName={profile?.full_name ?? ""} profileId={athleteId} />
          {!effective.isActingAsOther && (
            <p className="font-body text-xs text-steel mt-0.5">{user.email}</p>
          )}
        </div>
      </section>

      <section className="px-5 pt-8 space-y-6">
        {isCoach && (
          <SettingsGroup label="Coaching" highlight>
            <Link
              href={`/groups/${params.groupId}/dashboard`}
              className="font-body text-sm font-bold text-rust"
            >
              Coach Dashboard →
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
          </SettingsGroup>
        )}

        <SettingsGroup label="Profile">
          <ProfileDetailsEditor
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

        <SettingsGroup label="Notifications & Devices">
          <div className="pb-4 border-b border-steel/20">
            <PushNotificationToggle />
          </div>
          <div className="pt-4">
            <WearablePlaceholder
              groupId={params.groupId}
              ouraConnected={!!ouraConnection}
              ouraStatus={(ouraConnection?.status as "active" | "revoked" | "error" | undefined) ?? null}
              ouraError={searchParams.oura_error ?? null}
            />
          </div>
        </SettingsGroup>

        {!isCoach && (
          <SettingsGroup label="Billing">
            <PackagePicker packages={packages} />
            <div className="mt-3">
              <ManageBillingLink />
            </div>
          </SettingsGroup>
        )}

        <SettingsGroup label="Tools & Community">
          <div className="space-y-3">
            <Link
              href={`/groups/${params.groupId}/tools/one-rep-max`}
              className="block font-body text-sm text-rust"
            >
              1RM Calculator
            </Link>
            <Link
              href={`/groups/${params.groupId}/tools/macro-calculator`}
              className="block font-body text-sm text-rust"
            >
              Macro Calculator
            </Link>
            <Link href="/partners" className="block font-body text-sm text-rust">
              Find a training partner →
            </Link>
            <Link href={`/share/journey/${athleteId}`} className="block font-body text-sm text-rust">
              Share my progress →
            </Link>
            <Link
              href={`/groups/${params.groupId}/resources`}
              className="block font-body text-sm text-rust"
            >
              Resources
            </Link>
          </div>
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

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}

function SettingsGroup({
  label,
  highlight,
  children,
}: {
  label: string;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="font-body text-[10px] font-bold uppercase tracking-wide text-rust mb-2">
        {label}
      </p>
      <div
        className={`border rounded-lg p-4 ${
          highlight ? "border-rust/40 bg-surface/60" : "border-steel/20 bg-surface/30"
        }`}
      >
        {children}
      </div>
    </div>
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
