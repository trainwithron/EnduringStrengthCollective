import { createClient } from "@supabase/supabase-js";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { isPlaceholderEmail } from "@/lib/client-claim";
import { maskEmail } from "@/lib/mask-email";
import { mintClaimLink } from "@/lib/client-claim-server";
import { emailClaimLink } from "@/lib/claim-email";
import { rateLimitAllows } from "@/lib/rate-limit";

// "Resend invite / send a sign-in link": a coach can do this for a client at ANY time, whatever state the person is in, and is never refused for the state (Ron, Oct 17). What is sent depends on the person:
//   * never signed in  -> their sign-in (claim) link, emailed to the address on the account, or handed to the coach to copy or text when there is no address or email is not set up; a link that still works is replaced.
//   * has signed in    -> a fresh email to THEIR OWN address with a link to set a password and sign in. The coach never sees that link: once a person has signed in the account is theirs, and a coach-held link to it would
//                         be a way to sign in as them.
// The only waits are a minute between two sends to the same person, and one safety wait: for a day after the address on the account was changed no sign-in email goes out (so a changed address cannot be followed at
// once by a link to the new inbox). The message says plainly what was sent and where.
export type ResendResult =
  | { status: 200; body: { ok: true; kind: "claim_emailed" | "claim_link" | "signin_emailed"; message: string; sentTo?: string; link?: string; expiresAt?: string } }
  | { status: number; body: { error: string; link?: string } };

export async function resendAccess(args: { supabase: any; serviceRole: any; coachId: string; groupId: string; athleteId: string; origin: string }): Promise<ResendResult> {
  const { supabase, serviceRole, coachId, groupId, athleteId, origin } = args;

  const { data: caller } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", coachId).maybeSingle();
  if (caller?.role !== "coach") return { status: 403, body: { error: "Only this client's coach can do that." } };
  const { data: member } = await serviceRole.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  if (member?.role !== "athlete") return { status: 404, body: { error: "Client not found in this group." } };

  if (!(await rateLimitAllows(`resend-access:${athleteId}`, 1, 60))) {
    return { status: 429, body: { error: "Something was sent to them a moment ago. Wait a minute and try again." } };
  }

  const [{ data: profile }, { data: authData }, { data: coach }] = await Promise.all([
    serviceRole.from("profiles").select("full_name, claimed_at").eq("id", athleteId).maybeSingle(),
    serviceRole.auth.admin.getUserById(athleteId),
    serviceRole.from("profiles").select("full_name").eq("id", coachId).maybeSingle(),
  ]);
  if (!profile) return { status: 404, body: { error: "Client not found." } };
  const authUser = authData?.user ?? null;
  const email: string | null = authUser?.email ?? null;
  const hasRealEmail = !!email && !isPlaceholderEmail(email);
  const everSignedIn = !!profile.claimed_at || !!authUser?.last_sign_in_at;

  // ---- has not signed in: the claim link
  if (!everSignedIn) {
    const minted = await mintClaimLink(serviceRole, coachId, athleteId, origin);
    if (!minted.ok) return { status: 500, body: { error: "Couldn't make the link. Try again." } };
    if (hasRealEmail && isEmailConfigured()) {
      const sent = await emailClaimLink(serviceRole, { coachId, coachName: coach?.full_name ?? null, clientFullName: profile.full_name, toEmail: email!, link: minted.link });
      if (sent) {
        return { status: 200, body: { ok: true, kind: "claim_emailed", sentTo: maskEmail(email!), expiresAt: minted.expiresAt, message: `Sent a new sign-in link to ${maskEmail(email!)}. Any earlier link stopped working.` } };
      }
    }
    const why = !hasRealEmail ? "There is no email address on file for them" : !isEmailConfigured() ? "Email is not set up yet" : "The email could not be sent";
    return { status: 200, body: { ok: true, kind: "claim_link", link: minted.link, expiresAt: minted.expiresAt, message: `${why}, so here is their new sign-in link to copy or text. Any earlier link stopped working.` } };
  }

  // ---- has signed in: an email to their own address
  if (!hasRealEmail) {
    return { status: 400, body: { error: "They have signed in, but there is no email address on their account to send to. Ask them to use Forgot password on the sign-in page." } };
  }
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recentChange } = await serviceRole.from("notifications").select("id").eq("profile_id", athleteId).eq("type", "email_changed").gte("created_at", since).limit(1);
  if ((recentChange ?? []).length > 0) {
    return { status: 403, body: { error: "Their sign-in email was changed in the last 24 hours, so no link can be sent yet. They can sign in with the new address, or reset the password themselves." } };
  }

  // The mail service sends nothing to an address it has not confirmed, so for those the platform sends the same link itself.
  if (authUser?.email_confirmed_at) {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await anon.auth.resetPasswordForEmail(email!, { redirectTo: `${origin}/set-password` });
    if (!error) return { status: 200, body: { ok: true, kind: "signin_emailed", sentTo: maskEmail(email!), message: `Sent a sign-in email to ${maskEmail(email!)}. It lets them set a password and sign in. Ask them to check spam if it does not arrive in a few minutes.` } };
    if (!isEmailConfigured()) {
      const cooldown = /rate limit|too many|seconds/i.test(error.message);
      return { status: cooldown ? 429 : 502, body: { error: cooldown ? "A link was just sent. Wait a minute before sending another." : "The email couldn't be sent. Try again in a few minutes." } };
    }
  }
  if (!isEmailConfigured()) {
    return { status: 503, body: { error: "Their email address has not been confirmed and email sending is not set up, so nothing can be sent from here. Ask them to use Forgot password." } };
  }
  const { data: link, error: linkError } = await serviceRole.auth.admin.generateLink({ type: "recovery", email: email!, options: { redirectTo: `${origin}/set-password` } });
  const actionLink = (link as { properties?: { action_link?: string } } | null)?.properties?.action_link;
  if (linkError || !actionLink) return { status: 502, body: { error: "The email couldn't be sent. Try again in a few minutes." } };
  const sent = await sendEmail(email!, "Your sign-in link", `Hi ${profile.full_name.split(" ")[0] ?? ""},\n\n${coach?.full_name ?? "Your coach"} sent you this link to set a password and sign in:\n\n${actionLink}\n\nIf you were not expecting it, you can ignore this email.`);
  if (!sent) return { status: 502, body: { error: "The email couldn't be sent. Try again in a few minutes." } };
  return { status: 200, body: { ok: true, kind: "signin_emailed", sentTo: maskEmail(email!), message: `Sent a sign-in email to ${maskEmail(email!)}. It lets them set a password and sign in. Ask them to check spam if it does not arrive in a few minutes.` } };
}
