import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPlaceholderEmail, validateClaimEmail, validateNewPassword } from "@/lib/client-claim";

// Called by the set-password page once a client has chosen their password.
// It only ever acts on the signed-in person's OWN account, and it does the
// whole job in ONE step so nothing is left half-done:
//   - the email (for a coach-created account still on its placeholder address)
//     and the password are saved together in a single update. If that email
//     already belongs to another account the update fails and the password is
//     NOT changed, so the client can fix the address and try again instead of
//     ending up with a new password and no way in.
//   - only after that succeeds is the account marked as claimed.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const emailConfirm = typeof body.emailConfirm === "string" ? body.emailConfirm.trim() : "";

  const passwordError = validateNewPassword(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  const serviceRole = createServiceRoleClient();
  const needsEmail = isPlaceholderEmail(user.email);

  if (needsEmail) {
    const emailError = validateClaimEmail(email, emailConfirm);
    if (emailError) return NextResponse.json({ error: emailError }, { status: 400 });
  }

  const { error: updateError } = await serviceRole.auth.admin.updateUserById(
    user.id,
    needsEmail ? { email, password, email_confirm: true } : { password }
  );
  if (updateError) {
    console.error("complete-claim update failed:", updateError.message);
    // GoTrue reports a duplicate email only as a generic "Error updating user", so work out the
    // cause ourselves: does another account already use this address?
    const taken = needsEmail && (await emailBelongsToAnotherAccount(serviceRole, email, user.id));
    return NextResponse.json(
      {
        error: taken
          ? "That email already has an account, so we haven't changed anything. Check the spelling, or ask your coach for help."
          : "Couldn't save your details. Try again.",
      },
      { status: taken ? 409 : 500 }
    );
  }

  await serviceRole
    .from("profiles")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("claimed_at", null);

  // They're in: retire any link the coach still has open for them.
  await serviceRole
    .from("client_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("athlete_id", user.id)
    .is("used_at", null);

  return NextResponse.json({ ok: true });
}

// Looks through the account list for the address. Only runs after a failed update, and the user base
// is small, so a few pages at most.
async function emailBelongsToAnotherAccount(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  email: string,
  selfId: string
): Promise<boolean> {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await serviceRole.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) return false;
    if (data.users.some((u) => u.id !== selfId && (u.email ?? "").toLowerCase() === wanted)) return true;
    if (data.users.length < 1000) return false;
  }
  return false;
}
