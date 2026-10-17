import { isEmailConfigured, sendEmail } from "@/lib/email";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { sendPushToProfile } from "@/lib/send-push";

// Tells one existing account about an invitation (or an announcement): an in-app notification, and a plain transactional email to the address on the account when email is set up. Both are best effort and
// reported separately: the caller's answer to the person who made the invitation must not change with them (it never says whether an address has an account). A refused notification is logged, never ignored.
export async function notifyAndEmail(
  serviceRole: any,
  args: { profileId: string; type: "organization_invite" | "space_invite" | "org_announcement"; body: string; linkPath: string; origin: string; subject: string }
): Promise<{ notified: boolean; emailed: boolean }> {
  const { error } = await serviceRole.from("notifications").insert({ profile_id: args.profileId, type: args.type, body: args.body, link_path: args.linkPath });
  const notified = !error;
  if (error) console.error(`[invite-notify] notification (${args.type}) was refused:`, error.message);

  // A push to the phone (a failure, a missing subscription or the person's quiet hours change nothing else: the notice and the email are the reliable ones).
  await sendPushToProfile(serviceRole, args.profileId, args.subject, args.body, args.linkPath).catch(() => 0);

  let emailed = false;
  if (isEmailConfigured()) {
    try {
      const { data } = await serviceRole.auth.admin.getUserById(args.profileId);
      const to = data?.user?.email as string | undefined;
      if (to && !isPlaceholderEmail(to)) {
        emailed = await sendEmail(to, args.subject, `${args.body}\n\nOpen this link to see it and answer: ${args.origin}${args.linkPath}\n\nYou are getting this because someone invited you on Spotlight Coaching. If you were not expecting it, you can ignore it; nothing happens unless you accept.`);
      }
    } catch {
      // Deliberately ignored: the in-app notice is the main way; a failed email is not worth failing the invitation for.
    }
  }
  return { notified, emailed };
}
