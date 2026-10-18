import { isEmailConfigured, sendEmail } from "@/lib/email";

// Sign-in and invitation emails the SERVER sends itself, through the transactional mail service (Brevo), with a link made by the auth service (generateLink). Delivery then does not depend on the auth service's own
// mailer, which has a very small hourly limit and no domain authentication of its own. The link lands on /set-password, which reads the session out of the address (lib/auth-link.ts), as every server-made link does.
//
// What still goes through the auth service's own mailer (the person's own browser asks for it): the confirmation email of a sign-up made from an invite page, a changed sign-in email, "resend confirmation".
// Those need Authentication > SMTP Settings in the Supabase dashboard pointed at the mail service (a step only the owner can do; docs/NEEDS_RON.md).

export type AuthLinkType = "invite" | "recovery";

export interface MadeLink {
  link: string | null;
  userId: string | null;
  error: string | null;
}

/** A one-time link for this address, made without sending anything. For "invite" the account is created if it does not exist yet (an unconfirmed one is re-issued). */
export async function makeAuthLink(serviceRole: any, args: { type: AuthLinkType; email: string; redirectTo: string; fullName?: string }): Promise<MadeLink> {
  const options: Record<string, unknown> = { redirectTo: args.redirectTo };
  if (args.type === "invite" && args.fullName) options.data = { full_name: args.fullName };
  const { data, error } = await serviceRole.auth.admin.generateLink({ type: args.type, email: args.email, options });
  const link = (data as { properties?: { action_link?: string } } | null)?.properties?.action_link ?? null;
  const userId = (data as { user?: { id?: string } } | null)?.user?.id ?? null;
  if (error || !link) return { link: null, userId, error: error?.message ?? "no link was made" };
  return { link, userId, error: null };
}

const ROLE_PHRASE: Record<string, string> = { admin: "an admin", coach: "a coach", front_desk: "front desk staff", owner: "the owner" };

export function inviteEmail(args: { toName: string; orgName: string; inviterName: string | null; role: string; link: string }): { subject: string; text: string } {
  const first = args.toName.trim().split(/\s+/)[0] || "there";
  const by = args.inviterName ? `${args.inviterName} invited you` : "You have been invited";
  return {
    subject: `${args.orgName} invited you to join`,
    text: [
      `Hi ${first},`,
      "",
      `${by} to join ${args.orgName} on Spotlight Coaching as ${ROLE_PHRASE[args.role] ?? "a coach"}.`,
      "",
      "Open this link to choose a password and get started:",
      args.link,
      "",
      "The link works once and stops working after a day. If it has stopped working, ask whoever invited you to send it again.",
      "",
      "You are getting this because someone invited you on Spotlight Coaching. If you were not expecting it, you can ignore this message.",
    ].join("\n"),
  };
}

export function recoveryEmail(args: { toName: string | null; link: string; fromCoach?: string | null }): { subject: string; text: string } {
  const first = (args.toName ?? "").trim().split(/\s+/)[0];
  return {
    subject: args.fromCoach ? "Your sign-in link" : "Reset your password",
    text: [
      first ? `Hi ${first},` : "Hi,",
      "",
      args.fromCoach ? `${args.fromCoach} sent you this link to set a password and sign in:` : "Open this link to choose a new password:",
      args.link,
      "",
      "The link works once and stops working after a day.",
      "",
      args.fromCoach ? "If you were not expecting this, you can ignore this message." : "If you did not ask for this, you can ignore this message. Your password stays as it is.",
    ].join("\n"),
  };
}

/** Sends one of the messages above; false when mail is not set up or the service refused it. */
export async function sendAuthMail(to: string, message: { subject: string; text: string }): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  return sendEmail(to, message.subject, message.text);
}
