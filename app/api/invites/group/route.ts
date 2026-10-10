import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Cancel or extend a group invite link. The caller must coach the group the
// link belongs to; that is checked here, not left to the browser.
//   { action: "revoke", inviteId }  stop the link working (kept, greyed, for a week)
//   { action: "extend", inviteId }  give a live link another 7 days
//   { action: "create", groupId }   make the group's ONE current link (7 days) and cancel every other working link of that group
function newInviteCode(length = 10) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const { action, inviteId } = body;

  if (action === "create") {
    const groupId = typeof body.groupId === "string" ? body.groupId : "";
    if (!groupId) return NextResponse.json({ error: "Missing group." }, { status: 400 });
    const { data: callerRow } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
    if (callerRow?.role !== "coach") return NextResponse.json({ error: "Only a coach of this group can make its invite link." }, { status: 403 });
    const admin = createServiceRoleClient();
    // A client's own one-on-one space holds one client: a link that brings someone else in is refused (the database refuses too).
    const { data: kindRow } = await admin.from("groups").select("group_kind").eq("id", groupId).maybeSingle();
    if ((kindRow as { group_kind?: string } | null)?.group_kind === "one_on_one") return NextResponse.json({ error: "This is one client's own space, so it has no invite link. Add the client from your Clients page." }, { status: 422 });
    // Cancel every working link of this group (a new link replaces the old one). Falls back to deleting when the cancelled-at columns are not there yet.
    const { data: working } = await admin.from("group_invites").select("id").eq("group_id", groupId).is("revoked_at", null);
    const ids = ((working ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length > 0) {
      const { error: revokeError } = await admin.from("group_invites").update({ revoked_at: new Date().toISOString(), revoked_by: user.id }).in("id", ids);
      if (revokeError) await admin.from("group_invites").delete().in("id", ids);
    }
    const code = newInviteCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: insertError } = await admin.from("group_invites").insert({ group_id: groupId, code, role: "athlete", created_by: user.id, expires_at: expiresAt });
    if (insertError) return NextResponse.json({ error: "Couldn't make the link. Try again." }, { status: 500 });
    return NextResponse.json({ ok: true, code, expiresAt });
  }

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
