import { toFriendlyAuthEmailError } from "@/lib/auth-email-error";
import { placeholderEmailFor } from "@/lib/client-claim";

export type CreateUnclaimedClientResult = { ok: true; profileId: string } | { ok: false; error: string; status: number };

// Makes a real account and profile for a client who has never signed in, and puts them in the group. No email is sent. Used by adding one client and by importing a roster, so both behave the same.
// Without an email the account gets a placeholder address that can never receive mail. If any step fails the half-made account is removed, so nothing is left behind.
export async function createUnclaimedClient(serviceRole: any, args: { groupId: string; fullName: string; email: string }): Promise<CreateUnclaimedClientResult> {
  const { data: created, error: createError } = await serviceRole.auth.admin.createUser({
    email: args.email || placeholderEmailFor(crypto.randomUUID()),
    email_confirm: true,
    user_metadata: { full_name: args.fullName },
  });

  if (createError || !created?.user) {
    const raw: string = createError?.message ?? "Couldn't add this client.";
    if (/already|registered|exists/i.test(raw)) {
      return { ok: false, status: 409, error: "That email already has an account. Use an invite link instead so they join with their own login." };
    }
    const { error, status } = toFriendlyAuthEmailError(raw);
    return { ok: false, error, status };
  }

  const newUserId: string = created.user.id;

  // claimed_at = null marks the account as not yet signed into.
  const { error: profileError } = await serviceRole.from("profiles").insert({ id: newUserId, full_name: args.fullName, intake_required: true, claimed_at: null });
  if (profileError) {
    await serviceRole.auth.admin.deleteUser(newUserId).catch(() => {});
    return { ok: false, status: 502, error: `Couldn't create their profile: ${profileError.message}` };
  }

  const { error: membershipError } = await serviceRole.from("group_memberships").insert({ group_id: args.groupId, profile_id: newUserId, role: "athlete" });
  if (membershipError) {
    // Don't leave a half-made client behind (an account with a placeholder email and no group). Deleting the auth user removes its profile with it.
    await serviceRole.auth.admin.deleteUser(newUserId).catch(() => {});
    return { ok: false, status: 502, error: `Couldn't add them to the group: ${membershipError.message}` };
  }

  return { ok: true, profileId: newUserId };
}
