import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BroadcastComposer, type BroadcastAthlete, type BroadcastGroup } from "@/components/coach/broadcast-composer";
import { isUnder13 } from "@/lib/coppa";

// Bulk announcement composer. Recipients are limited to groups where the
// viewer is a COACH (never an org-admin-only view of other coaches'
// groups) and to training memberships — the send route re-validates all
// of it server-side regardless of what this page offered.
export default async function AnnouncePage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can send announcements.</p>
      </main>
    );
  }

  const { data: coachedRows } = await supabase
    .from("group_memberships")
    .select("group_id, groups ( id, name, organization_id )")
    .eq("profile_id", user.id)
    .eq("role", "coach");
  const coachedGroups = (coachedRows ?? [])
    .map((r: any) => r.groups)
    .filter(Boolean) as { id: string; name: string; organization_id: string }[];

  // This page's own group first, so it leads the selection order.
  coachedGroups.sort((a, b) => (a.id === params.groupId ? -1 : b.id === params.groupId ? 1 : a.name.localeCompare(b.name)));

  const orgIds = [...new Set(coachedGroups.map((g) => g.organization_id))];
  const { data: orgRows } = orgIds.length
    ? await supabase.from("organizations").select("id, name, display_name").in("id", orgIds)
    : { data: [] as { id: string; name: string; display_name: string | null }[] };
  const orgNameById = new Map((orgRows ?? []).map((o: any) => [o.id, o.display_name || o.name]));
  const spansMultipleOrgs = orgIds.length > 1;

  const groups: BroadcastGroup[] = coachedGroups.map((g) => ({
    id: g.id,
    name: g.name,
    orgName: spansMultipleOrgs ? orgNameById.get(g.organization_id) ?? null : null,
  }));

  const groupIds = groups.map((g) => g.id);
  const { data: memberRows } = groupIds.length
    ? await supabase
        .from("group_memberships")
        .select("group_id, profile_id, profiles ( full_name )")
        .eq("role", "athlete")
        .eq("membership_type", "training")
        .in("group_id", groupIds)
    : { data: [] };

  const athleteIds = [...new Set((memberRows ?? []).map((m: any) => m.profile_id as string))];
  const [{ data: intakeRows }, { data: consentRows }] = athleteIds.length
    ? await Promise.all([
        supabase.from("client_intake").select("athlete_id, date_of_birth").in("athlete_id", athleteIds),
        supabase.from("minor_consent").select("athlete_id, verified").in("athlete_id", athleteIds),
      ])
    : [{ data: [] }, { data: [] }];
  const dobById = new Map((intakeRows ?? []).map((r: any) => [r.athlete_id, r.date_of_birth as string | null]));
  const consentVerified = new Set((consentRows ?? []).filter((r: any) => r.verified).map((r: any) => r.athlete_id));
  const now = new Date();

  const athletes: BroadcastAthlete[] = (memberRows ?? []).map((m: any) => {
    const dob = dobById.get(m.profile_id);
    const minorWithoutConsent = !!dob && isUnder13(dob, now) && !consentVerified.has(m.profile_id);
    return {
      athleteId: m.profile_id,
      groupId: m.group_id,
      fullName: m.profiles?.full_name ?? "Unknown",
      excludedByDefault: minorWithoutConsent,
    };
  });

  const { data: group } = await supabase.from("groups").select("name").eq("id", params.groupId).single();

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="messages">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Announcement</h1>
        <p className="font-body text-sm text-steel mt-2">
          Send one message to all your clients, with each person&apos;s first name filled in. Delivered as an
          in-app message plus a push notification.
        </p>
      </div>
      <BroadcastComposer groups={groups} athletes={athletes} />
    </CoachDesktopShell>
  );
}
