import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-url";
import { notifyAndEmail } from "@/lib/invite-notify";

// Sends an organization invitation again: gives it fourteen more days and tells the person again (a notice in the app and an email). The database function checks the caller is the organization's owner or admin and
// that the invitation is still open; nothing here decides that.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimitResponse("org-invite-resend", user.id, 20, 3600);
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const inviteId = raw && typeof raw === "object" && typeof (raw as { inviteId?: unknown }).inviteId === "string" ? (raw as { inviteId: string }).inviteId : "";
  if (!inviteId) return NextResponse.json({ error: "Missing the invitation." }, { status: 400 });

  const { error: extendError } = await supabase.rpc("extend_org_invite", { p_invite: inviteId });
  if (extendError) return NextResponse.json({ error: extendError.message }, { status: 400 });

  const db = createServiceRoleClient();
  const { data: invite } = await db.from("organization_invites").select("id, invited_profile_id, role, organization_id").eq("id", inviteId).maybeSingle();
  if (!invite) return NextResponse.json({ error: "That invitation was not found." }, { status: 404 });
  const { data: org } = await db.from("organizations").select("name").eq("id", invite.organization_id).maybeSingle();
  const orgName = (org as { name?: string } | null)?.name ?? "An organization";
  const result = await notifyAndEmail(db, {
    profileId: invite.invited_profile_id,
    type: "organization_invite",
    body: `${orgName} invited you to join as ${invite.role === "admin" ? "an admin" : "a coach"}.`,
    linkPath: `/org-invite/${invite.id}`,
    origin: appOrigin(request),
    subject: `${orgName} invited you to join`,
  });
  return NextResponse.json({ ok: true, notified: result.notified, emailed: result.emailed });
}
