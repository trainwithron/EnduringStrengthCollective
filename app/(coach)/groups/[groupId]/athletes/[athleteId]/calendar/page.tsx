import { NoAccess } from "@/components/shared/no-access";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClientCalendarSection } from "@/components/coach/desktop/client-calendar-section";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";

export default async function ClientCalendarPage(
  props: {
    params: Promise<{ groupId: string; athleteId: string }>;
    searchParams: Promise<{ month?: string }>;
  }
) {
  const searchParams = await props.searchParams;
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
      <NoAccess>Only coaches can view a client&apos;s calendar.</NoAccess>
    );
  }

  const { data: athleteMembership } = await supabase
    .from("group_memberships")
    .select("profiles ( full_name ), client_tier")
    .eq("group_id", params.groupId)
    .eq("profile_id", params.athleteId)
    .maybeSingle();

  if (!athleteMembership) {
    return (
      <NoAccess>This client isn&apos;t in this group.</NoAccess>
    );
  }

  const athleteName = (athleteMembership.profiles as any)?.full_name ?? "Client";
  // Macro programming isn't part of what a low-ticket group client pays
  // for — same gate as the day-detail page, applied here too so it's
  // never surfaced anywhere on this client's calendar.
  const macrosEnabled = athleteMembership.client_tier !== "group";

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();
  const backHref = `/groups/${params.groupId}/athletes/${params.athleteId}`;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="clients">
      <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
        &larr; Back to {athleteName}
      </Link>
      <h1 className="font-display font-bold text-2xl uppercase leading-tight mt-3 mb-6">
        {athleteName}&apos;s Calendar
      </h1>
      <ClientCalendarSection
        groupId={params.groupId}
        athleteId={params.athleteId}
        coachId={user.id}
        athleteName={athleteName}
        macrosEnabled={macrosEnabled}
        monthParam={searchParams.month}
        monthHref={(key) => `${backHref}/calendar?month=${key}`}
      />
    </CoachDesktopShell>
  );
}
