import { redirect } from "next/navigation";
import { createCrossOrgServerClient as createServerClient } from "@/lib/supabase/server";
import { SpaceInviteAnswer } from "@/components/org/space-invite-answer";

export const metadata = { title: "Space invite" };

// A coach's invitation to be their one-on-one client, for someone who already has an account. They see who invited them and choose; nothing is joined until they accept.
export default async function SpaceInvitePage(props: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/space-invite/${inviteId}`)}`);

  // Row security shows the invitation only to the person it is for (or a coach of the space, who is not shown the buttons).
  const { data: invite } = await supabase
    .from("space_invites")
    .select("id, invited_profile_id, answered_at, expires_at, created_by")
    .eq("id", inviteId)
    .maybeSingle();

  const row = invite as { id: string; invited_profile_id: string; answered_at: string | null; expires_at: string; created_by: string } | null;
  const mine = !!row && row.invited_profile_id === user.id;
  const open = mine && !row!.answered_at && new Date(row!.expires_at).getTime() > Date.now();
  let coachName = "A coach";
  if (open) {
    const { data: coach } = await supabase.from("profiles").select("full_name").eq("id", row!.created_by).maybeSingle();
    coachName = (coach as { full_name?: string } | null)?.full_name ?? coachName;
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        {open ? (
          <>
            <h1 className="font-display font-bold text-3xl uppercase leading-none">Be {coachName}&apos;s client?</h1>
            <p className="font-body text-sm text-steel mt-2">
              {coachName} invited you to train with them in a space of your own. You join only if you accept. Your records with your other coaches stay separate and private from them.
            </p>
            <SpaceInviteAnswer inviteId={row!.id} />
          </>
        ) : (
          <>
            <h1 className="font-display font-bold text-3xl uppercase leading-none">This invitation is not open</h1>
            <p className="font-body text-sm text-steel mt-2">It may have been answered or expired. Ask your coach to send a new one.</p>
          </>
        )}
      </div>
    </main>
  );
}
