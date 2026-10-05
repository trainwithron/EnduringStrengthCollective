import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { validateClaimEmail } from "@/lib/client-claim";

// A coach correcting the email on a client's account AFTER the client has
// claimed it (a wrong-but-valid address no verification email caught). Before the
// claim, /api/clients/fix-email does this. Afterwards it is the client's account,
// so this asks for the address twice, is only for that client's coach, and tells
// the client in the app that it happened.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { groupId, athleteId, email, emailConfirm } = await request.json();
  if (!groupId || !athleteId) return NextResponse.json({ error: "Missing groupId or athleteId." }, { status: 400 });
  const trimmed = typeof email === "string" ? email.trim() : "";
  const emailError = validateClaimEmail(trimmed, typeof emailConfirm === "string" ? emailConfirm : "");
  if (emailError) return NextResponse.json({ error: emailError }, { status: 400 });

  const { data: caller } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (caller?.role !== "coach") {
    return NextResponse.json({ error: "Only this client's coach can do that." }, { status: 403 });
  }

  const serviceRole = createServiceRoleClient();
  const { data: member } = await serviceRole
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", athleteId)
    .maybeSingle();
  if (member?.role !== "athlete") return NextResponse.json({ error: "Client not found in this group." }, { status: 404 });

  const { error } = await serviceRole.auth.admin.updateUserById(athleteId, { email: trimmed, email_confirm: true });
  if (error) {
    // GoTrue reports a duplicate only as a generic failure, so check the list ourselves. This caller is a
    // signed-in coach of the client, so telling them is fine.
    let taken = false;
    for (let page = 1; page <= 20 && !taken; page++) {
      const { data } = await serviceRole.auth.admin.listUsers({ page, perPage: 1000 });
      if (!data?.users?.length) break;
      taken = data.users.some((u) => u.id !== athleteId && (u.email ?? "").toLowerCase() === trimmed.toLowerCase());
      if (data.users.length < 1000) break;
    }
    return NextResponse.json(
      { error: taken ? "That email already has an account, so nothing was changed." : "Couldn't update the email. Try again." },
      { status: taken ? 409 : 500 }
    );
  }

  // Tell the client in the app. Best effort: the change has already happened either way.
  await serviceRole.from("notifications").insert({
    profile_id: athleteId,
    group_id: groupId,
    type: "email_changed",
    body: "Your coach updated the email address on your account. You now sign in with the new one.",
    link_path: null,
  });

  return NextResponse.json({ ok: true, email: trimmed });
}
