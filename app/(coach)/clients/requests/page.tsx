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

// The coach's waiting requests ("Request to train with me" on their public page), with Approve and Decline. Nothing a visitor sends gives them any access until the coach approves here. Only the organization the coach is working in.
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

  const pendingRes = await supabase.rpc("coach_client_requests", { p_status: "pending", p_org: anchor.orgId });
  const rows: RequestRow[] = ((pendingRes.data ?? []) as { id: string; display_name: string; age_band: string; created_at: string }[]).map((r) => ({
    id: r.id,
    name: r.display_name,
    ageBand: r.age_band === "adult" || r.age_band === "teen" ? r.age_band : "unknown",
    createdAt: r.created_at,
  }));

  const body = pendingRes.error ? (
    <p className="font-body text-sm text-rust" role="alert">
      Couldn&apos;t load your requests. Refresh the page to try again.
    </p>
  ) : (
    <ClientRequestsPanel organizationId={anchor.orgId} requests={rows} supportEmail={supportEmail()} />
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
