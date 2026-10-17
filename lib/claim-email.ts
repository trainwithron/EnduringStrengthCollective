import { DEFAULT_CLAIM_TEMPLATE, renderTemplate, validateTemplate, withFooter, type MessageTemplate } from "@/lib/message-template";
import { sendEmail } from "@/lib/email";

// Emails a client their sign-in (claim) link, in the coach's own wording if they wrote one (and it is still valid, with {link} in it), otherwise the default. Used by "Email the sign-in link" and by "Resend invite".
// Returns false when the email could not be sent (the caller then hands the link back to copy or text).
export async function emailClaimLink(
  serviceRole: any,
  args: { coachId: string; coachName: string | null; clientFullName: string; toEmail: string; link: string }
): Promise<boolean> {
  let template: MessageTemplate = DEFAULT_CLAIM_TEMPLATE;
  // Before the template table exists the read just errors and the default is used.
  const { data: custom } = await serviceRole.from("coach_message_templates").select("claim_email_subject, claim_email_body").eq("coach_id", args.coachId).maybeSingle();
  if (custom) {
    const checked = validateTemplate({ subject: custom.claim_email_subject, body: custom.claim_email_body });
    if (checked.ok) template = checked.template;
  }
  const message = renderTemplate(template, { firstName: args.clientFullName.split(" ")[0] ?? "", coachName: args.coachName, link: args.link });
  return sendEmail(args.toEmail, message.subject, withFooter(message.text, args.coachName));
}
