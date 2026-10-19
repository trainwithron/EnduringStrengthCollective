import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { CoachMobileShell } from "@/components/coach/mobile/coach-mobile-shell";
import { ClientRequestsPanel, type RequestRow } from "@/components/coach/client-requests-panel";
import { CHOOSE_ORGANIZATION_PATH, getActiveAnchor } from "@/lib/active-anchor";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { supportEmail } from "@/lib/legal";

export const metadata = { title: "Client requests" };

// The coach's waiting requests ("Request to train with me" on their public page), with Approve and Decline. Nothing a visitor sends gives them any access until the coach approves here. Every organization the coach belongs to, with the organization's name on each row when there is more than one.
export default async function ClientRequestsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActiveAnchor(supabase, user.id);
  if (active?.needsChoice) redirect(`${CHOOSE_ORGANIZATION_PATH}?next=/clients/requests`);
  const anchor = active?.anchor ?? null;
  if (!anchor) return <NoAccess>Only coaches have client requests.</NoAccess>;

  // EVERY organization the coach belongs to, not only the one they are working in: a request goes to the organization the coach's public page belongs to (the one they own first), which may not be the open one.
  const memberRes = await supabase.from("organization_memberships").select("organization_id, organizations ( name )").eq("profile_id", user.id);
  const orgs = ((memberRes.data ?? []) as unknown as { organization_id: string; organizations: { name: string | null } | { name: string | null }[] | null }[]).map((m) => ({
    id: m.organization_id,
    name: (Array.isArray(m.organizations) ? m.organizations[0]?.name : m.organizations?.name) ?? null,
  }));
  const perOrg = await Promise.all(orgs.map(async (o) => ({ org: o, res: await supabase.rpc("coach_client_requests", { p_status: "pending", p_org: o.id }) })));
  const failed = !!memberRes.error || perOrg.some((p) => !!p.res.error);
  const rows: RequestRow[] = perOrg
    .flatMap(({ org, res }) =>
      ((res.data ?? []) as { id: string; display_name: string; created_at: string }[]).map((r) => ({
        id: r.id,
        name: r.display_name,
        organizationId: org.id,
        organizationName: orgs.length > 1 ? org.name : null,
        createdAt: r.created_at,
      }))
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const body = failed ? (
    <p className="font-body text-sm text-rust" role="alert">
      Couldn&apos;t load your requests. Refresh the page to try again.
    </p>
  ) : (
    <ClientRequestsPanel requests={rows} supportEmail={supportEmail()} />
  );

  if (await prefersAthleteStyleView()) {
    return (
      <CoachMobileShell groupId={anchor.id} groupName={anchor.name} activeOverride="roster">
        <div className="min-h-screen bg-graphite text-chalk font-body pb-24 px-5 pt-8">
          <h1 className="font-display font-bold text-2xl uppercase leading-none mb-2">Client requests</h1>
          <Link href={`/groups/${anchor.id}/clients`} className="font-body text-sm text-steel underline underline-offset-2">
            Back to Clients
          </Link>
          <div className="mt-5">{body}</div>
        </div>
      </CoachMobileShell>
    );
  }
  return (
    <CoachDesktopShell groupId={anchor.id} groupName={anchor.name} active="clients" coachLevel>
      <div className="pb-6 border-b border-steel/20 mb-6 flex items-center justify-between gap-4">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Client requests</h1>
        <Link href="/clients" className="font-body text-sm text-steel underline underline-offset-2">
          Back to Clients
        </Link>
      </div>
      {body}
    </CoachDesktopShell>
  );
}
