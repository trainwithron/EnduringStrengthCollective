import { redirect } from "next/navigation";
import { createCrossOrgServerClient as createServerClient } from "@/lib/supabase/server";
import { OrgInviteAnswer } from "@/components/org/org-invite-answer";

export const metadata = { title: "Org invite" };

// An invitation to join an organization, for someone who already has an account. They see who invited them and choose; nothing is joined until they accept.
export default async function OrgInvitePage(props: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/org-invite/${inviteId}`)}`);

  // Row security shows the invitation only to the person it is for (or the organization's owner and admins, who are not shown the buttons).
  const { data: invite } = await supabase
    .from("organization_invites")
    .select("id, role, invited_profile_id, answered_at, accepted, expires_at, organization_id, organizations ( name )")
    .eq("id", inviteId)
    .maybeSingle();

  const row = invite as { id: string; role: string; invited_profile_id: string; answered_at: string | null; expires_at: string; organizations?: { name?: string } | null } | null;
  const orgName = row?.organizations?.name ?? "this organization";
  const mine = !!row && row.invited_profile_id === user.id;
  const open = mine && !row!.answered_at && new Date(row!.expires_at).getTime() > Date.now();

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        {open ? (
          <>
            <h1 className="font-display font-bold text-3xl uppercase leading-none">Join {orgName}?</h1>
            <p className="font-body text-sm text-steel mt-2">
              {orgName} invited you to join as {row!.role === "admin" ? "an admin" : "a coach"}. You join only if you accept, and you can leave later from your settings.
            </p>
            <OrgInviteAnswer inviteId={row!.id} />
          </>
        ) : (
          <>
            <h1 className="font-display font-bold text-3xl uppercase leading-none">This invitation is not open</h1>
            <p className="font-body text-sm text-steel mt-2">It may have been answered or expired. Ask the organization to send a new one.</p>
          </>
        )}
      </div>
    </main>
  );
}
