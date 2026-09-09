import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Which org-level role an invite can grant. "owner" is set once at
// org creation and never assigned through this flow.
const INVITABLE_ORG_ROLES = new Set(["admin", "coach"]);

export async function POST(request: Request) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { groupId, fullName, email, orgRole } = await request.json();
  const trimmedName = typeof fullName === "string" ? fullName.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  const role = INVITABLE_ORG_ROLES.has(orgRole) ? orgRole : "coach";
  if (!groupId || !trimmedName || !trimmedEmail) {
    return NextResponse.json({ error: "Missing groupId, fullName, or email." }, { status: 400 });
  }

  const { data: group } = await supabase
    .from("groups")
    .select("organization_id")
    .eq("id", groupId)
    .maybeSingle();
  if (!group?.organization_id) {
    return NextResponse.json({ error: "This group isn't part of an organization." }, { status: 400 });
  }

  const { data: callerOrgMembership } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", group.organization_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (callerOrgMembership?.role !== "owner" && callerOrgMembership?.role !== "admin") {
    return NextResponse.json(
      { error: "Only an organization owner or admin can invite coaches." },
      { status: 403 }
    );
  }

  const serviceRole = createServiceRoleClient();
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;

  const { data: invited, error: inviteError } = await serviceRole.auth.admin.inviteUserByEmail(
    trimmedEmail,
    {
      data: { full_name: trimmedName },
      redirectTo: `${origin}/set-password`,
    }
  );

  if (inviteError || !invited?.user) {
    const message = inviteError?.message ?? "Couldn't invite this coach.";
    const isDuplicate = /already registered|already exists|already been registered/i.test(message);
    return NextResponse.json(
      { error: isDuplicate ? "That email is already registered to an account." : message },
      { status: isDuplicate ? 409 : 502 }
    );
  }

  const newUserId = invited.user.id;

  const { error: profileError } = await serviceRole
    .from("profiles")
    .insert({ id: newUserId, full_name: trimmedName });
  if (profileError) {
    return NextResponse.json({ error: `Couldn't create their profile: ${profileError.message}` }, { status: 502 });
  }

  const { error: groupMembershipError } = await serviceRole
    .from("group_memberships")
    .insert({ group_id: groupId, profile_id: newUserId, role: "coach" });
  if (groupMembershipError) {
    return NextResponse.json(
      { error: `Couldn't add them to the group: ${groupMembershipError.message}` },
      { status: 502 }
    );
  }

  const { error: orgMembershipError } = await serviceRole
    .from("organization_memberships")
    .insert({ organization_id: group.organization_id, profile_id: newUserId, role });
  if (orgMembershipError) {
    return NextResponse.json(
      { error: `Couldn't add them to the organization: ${orgMembershipError.message}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ profileId: newUserId });
}
