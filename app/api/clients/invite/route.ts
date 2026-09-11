import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { toFriendlyAuthEmailError } from "@/lib/auth-email-error";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { groupId, fullName, email } = await request.json();
  const trimmedName = typeof fullName === "string" ? fullName.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (!groupId || !trimmedName || !trimmedEmail) {
    return NextResponse.json({ error: "Missing groupId, fullName, or email." }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return NextResponse.json({ error: "Only coaches can add clients." }, { status: 403 });
  }

  const serviceRole = createServiceRoleClient();
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;

  // Creates the real auth.users row and sends Supabase's own invite
  // email in one call — profiles.id is a hard FK to auth.users, so there
  // is no way to create a client record without a genuine account behind
  // it. The person sets their own password whenever they get to it via
  // the link this sends; until then, the coach can already build/assign
  // a program for them.
  const { data: invited, error: inviteError } = await serviceRole.auth.admin.inviteUserByEmail(
    trimmedEmail,
    {
      data: { full_name: trimmedName },
      redirectTo: `${origin}/set-password`,
    }
  );

  if (inviteError || !invited?.user) {
    const { error, status } = toFriendlyAuthEmailError(inviteError?.message ?? "Couldn't invite this client.");
    return NextResponse.json({ error }, { status });
  }

  const newUserId = invited.user.id;

  const { error: profileError } = await serviceRole
    .from("profiles")
    .insert({ id: newUserId, full_name: trimmedName, intake_required: true });
  if (profileError) {
    return NextResponse.json({ error: `Couldn't create their profile: ${profileError.message}` }, { status: 502 });
  }

  const { error: membershipError } = await serviceRole
    .from("group_memberships")
    .insert({ group_id: groupId, profile_id: newUserId, role: "athlete" });
  if (membershipError) {
    return NextResponse.json(
      { error: `Couldn't add them to the group: ${membershipError.message}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ profileId: newUserId });
}
