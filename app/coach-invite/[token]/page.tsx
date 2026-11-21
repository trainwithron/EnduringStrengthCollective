import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { JOIN_LINK_COLUMNS, joinLinkState, joinLinkToken, parseInviteLinkToken, type JoinLinkRow } from "@/lib/coach-join-link";

export const metadata = { title: "Invitation" };
export const dynamic = "force-dynamic";

// The link the Invite coach form's Copy link hands out (desktop audit D24, review Nov 21): one shape for both kinds of invitation, worked out here on the server. READ ONLY, like the join page:
// it changes nothing and uses nothing up. It says nothing about who was invited, by whom or to what, and nothing about which kind it is, to anyone who is not the person it is for:
//   * an invitation for someone who already had an account: that person, signed in, goes on to it (/org-invite/…); signed out, they are asked to sign in and come back here;
//   * an invitation for a new address (their join link, which is how a person with no account gets in): signed out, they go on to choose their password, as the emailed link does;
//   * anyone else signed in (the person who invited them, another account) gets the same plain page whatever the link is, and a link that is not open gets that page too.
export default async function CoachInviteLinkPage(props: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await props.params;
  let token = rawToken;
  try {
    token = decodeURIComponent(rawToken);
  } catch {
    // left as it came
  }
  const here = `/coach-invite/${encodeURIComponent(token)}`;
  const id = parseInviteLinkToken(token);

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (id) {
    const db = createServiceRoleClient();
    const [{ data: joinRow }, { data: inviteRow }] = await Promise.all([
      db.from("coach_join_links").select(JOIN_LINK_COLUMNS).eq("id", id).maybeSingle(),
      db.from("organization_invites").select("id, invited_profile_id, answered_at, expires_at").eq("id", id).maybeSingle(),
    ]);
    const join = joinRow as JoinLinkRow | null;
    const invite = inviteRow as { id: string; invited_profile_id: string; answered_at: string | null; expires_at: string } | null;
    if (join && joinLinkState(join) === "open" && !user) redirect(`/join-coach/${joinLinkToken(join.id)}`);
    if (invite && !invite.answered_at && new Date(invite.expires_at).getTime() > Date.now()) {
      if (!user) redirect(`/login?next=${encodeURIComponent(here)}`);
      if (user.id === invite.invited_profile_id) redirect(`/org-invite/${invite.id}`);
    }
  }
  // Signed out with a link that is not open (or not a real one): the same sign-in step as an in-app invitation, so a signed-out opener cannot tell the two apart either.
  if (!user) redirect(`/login?next=${encodeURIComponent(here)}`);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16 text-center">
      <div className="w-full max-w-sm">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">This invitation is for someone else</h1>
        <p className="font-body text-sm text-steel mt-3">
          It opens only for the person it was sent to. If that is you, open it signed in with the account it was sent to, or signed out if you are new to Spotlight. If it no longer works, ask
          for a new one.
        </p>
      </div>
    </main>
  );
}
