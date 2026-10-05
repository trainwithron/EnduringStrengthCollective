import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Cancel or extend a group invite link. The caller must coach the group the
// link belongs to; that is checked here, not left to the browser.
//   { action: "revoke", inviteId }  stop the link working (kept, greyed, for a week)
//   { action: "extend", inviteId }  give a live link another 7 days
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { action, inviteId } = await request.json();
  if (!inviteId || (action !== "revoke" && action !== "extend")) {
    return NextResponse.json({ error: "Missing inviteId or action." }, { status: 400 });
  }

  const serviceRole = createServiceRoleClient();
  const { data: invite } = await serviceRole
    .from("group_invites")
    .select("id, group_id")
    .eq("id", inviteId)
    .maybeSingle();
  if (!invite) return NextResponse.json({ error: "That invite no longer exists." }, { status: 404 });

  const { data: caller } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", invite.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (caller?.role !== "coach") {
    return NextResponse.json({ error: "Only a coach of this group can change its invites." }, { status: 403 });
  }

  if (action === "extend") {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await serviceRole.from("group_invites").update({ expires_at: expiresAt }).eq("id", inviteId);
    if (error) return NextResponse.json({ error: "Couldn't extend the link. Try again." }, { status: 500 });
    return NextResponse.json({ ok: true, expiresAt });
  }

  // Revoke: keep the row (greyed for a week) so "where did that link go" has an answer.
  const { error } = await serviceRole
    .from("group_invites")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("id", inviteId);
  if (error) {
    // The revoked_* columns come from a later database update. Until it is applied, deleting the
    // row stops the link just as well; it just can't be shown as "cancelled" afterwards.
    const { error: deleteError } = await serviceRole.from("group_invites").delete().eq("id", inviteId);
    if (deleteError) return NextResponse.json({ error: "Couldn't cancel the link. Try again." }, { status: 500 });
    return NextResponse.json({ ok: true, removed: true });
  }
  return NextResponse.json({ ok: true });
}
