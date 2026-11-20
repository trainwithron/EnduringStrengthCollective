import type { SupabaseClient } from "@supabase/supabase-js";
import { mintClaimLink } from "@/lib/client-claim-server";
import { DEFAULT_CLAIM_TEMPLATE, renderTemplate, validateTemplate, withFooter, type MessageTemplate } from "@/lib/message-template";
import { sendEmail } from "@/lib/email";

// Emails one client who has never signed in their own sign-in (claim) link, in the coach's wording when they wrote one. Shared by the one-client button (/api/clients/email-claim-link) and "email
// everyone not signed in yet" (/api/clients/email-claim-links-all), so both send exactly the same email. The caller has already checked who may send, to whom, and how often; this only makes the link
// (a new one replaces any earlier one) and sends it. A transactional email (an account the coach made for them), never marketing.
export async function sendClaimEmail(
  serviceRole: SupabaseClient,
  args: { coachId: string; athleteId: string; fullName: string; email: string; origin: string; coachName?: string | null; template?: MessageTemplate }
): Promise<{ ok: true; expiresAt: string } | { ok: false; link: string | null }> {
  const minted = await mintClaimLink(serviceRole, args.coachId, args.athleteId, args.origin);
  if (!minted.ok) return { ok: false, link: null };
  const coachName = args.coachName !== undefined ? args.coachName : await loadCoachName(serviceRole, args.coachId);
  const template = args.template ?? (await loadClaimTemplate(serviceRole, args.coachId));
  const message = renderTemplate(template, { firstName: args.fullName.split(" ")[0] ?? "", coachName, link: minted.link });
  const sent = await sendEmail(args.email, message.subject, withFooter(message.text, coachName));
  return sent ? { ok: true, expiresAt: minted.expiresAt } : { ok: false, link: minted.link };
}

export async function loadCoachName(serviceRole: SupabaseClient, coachId: string): Promise<string | null> {
  const { data: coach } = await serviceRole.from("profiles").select("full_name").eq("id", coachId).maybeSingle();
  return (coach as { full_name?: string | null } | null)?.full_name ?? null;
}

// The coach's own wording if they wrote one (and it is still valid, with {link} in it); otherwise the default. Before the template table exists the read just errors and the default is used.
export async function loadClaimTemplate(serviceRole: SupabaseClient, coachId: string): Promise<MessageTemplate> {
  const { data: custom } = await serviceRole.from("coach_message_templates").select("claim_email_subject, claim_email_body").eq("coach_id", coachId).maybeSingle();
  if (custom) {
    const checked = validateTemplate({ subject: (custom as { claim_email_subject: string }).claim_email_subject, body: (custom as { claim_email_body: string }).claim_email_body });
    if (checked.ok) return checked.template;
  }
  return DEFAULT_CLAIM_TEMPLATE;
}
