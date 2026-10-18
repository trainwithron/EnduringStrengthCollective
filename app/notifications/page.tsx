import { PendingEmailChangeBanner } from "@/components/auth/pending-email-change-banner";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createCrossOrgServerClient as createServerClient } from "@/lib/supabase/server";
import { CoachHomeShell } from "@/components/coach/coach-home-shell";
import { NotificationList, type CenterEntry } from "@/components/notifications/notification-list";
import { LoadFailed } from "@/components/ui/load-failed";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/format-in-timezone";
import { CHOOSE_ORGANIZATION_PATH, getActiveAnchor } from "@/lib/active-anchor";

export const metadata = { title: "Notifications" };

// Every notification the signed-in person has received, in one place, whatever their role: replies, programs and macros assigned, class
// changes, partner requests, notices from their organization. The bell in the header shows the latest few and links here.
export default async function NotificationsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: memberships }, { data: rows, error: rowsError }] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    supabase.from("group_memberships").select("group_id, role").eq("profile_id", user.id),
    supabase
      .from("notifications")
      .select("id, body, link_path, read_at, created_at, group_id, groups ( name )")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const timezone = isValidTimeZone(profile?.timezone) ? (profile!.timezone as string) : DEFAULT_COACH_TIMEZONE;
  const isCoach = (memberships ?? []).some((m) => m.role === "coach");
  const homeGroupId = (memberships ?? [])[0]?.group_id ?? null;

  // A coach sees the OPEN organization's notifications here, never another organization's (a coach who runs several chooses one first).
  let visibleRows = rows ?? [];
  if (isCoach) {
    const active = await getActiveAnchor(supabase, user.id);
    if (active?.needsChoice) redirect(`${CHOOSE_ORGANIZATION_PATH}?next=/notifications`);
    if (active) {
      const orgGroupIds = new Set(active.groups.filter((g) => g.orgId === active.orgId).map((g) => g.id));
      visibleRows = visibleRows.filter((n: any) => (!n.group_id || orgGroupIds.has(n.group_id)));
    }
  }

  const entries: CenterEntry[] = visibleRows.map((n: any) => ({
    id: n.id,
    body: n.body,
    linkPath: n.link_path ?? "/",
    createdAt: n.created_at,
    readAt: n.read_at,
    groupName: n.groups?.name ?? null,
  }));

  const content = (
    <div className="max-w-2xl">
      <h1 className="font-display font-bold text-2xl uppercase mb-6">Notifications</h1>
      {rowsError ? <LoadFailed /> : <NotificationList initial={entries} timezone={timezone} />}
    </div>
  );

  if (isCoach) {
    const { data: orgMembership } = await supabase
      .from("organization_memberships")
      .select("organizations ( name, display_name )")
      .eq("profile_id", user.id)
      .limit(1)
      .maybeSingle();
    const org = (orgMembership as any)?.organizations;
    return <CoachHomeShell orgName={org?.display_name || org?.name || "Your Coaching Business"}>{content}</CoachHomeShell>;
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 py-8">
      <PendingEmailChangeBanner userId={user.id} />
      <div className="max-w-2xl mx-auto">
        <Link href={homeGroupId ? `/groups/${homeGroupId}` : "/"} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Home
        </Link>
        <div className="mt-4">{content}</div>
      </div>
    </main>
  );
}
