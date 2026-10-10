import { CLAIM_LINK_LIFETIME_HOURS } from "@/lib/client-claim";

// The wording of the email that carries a client's sign-in link. The app supplies a default; a coach can write their own. Plain text only, with three placeholders:
//   {first_name}  the client's first name     {coach_name}  the coach's name     {link}  the sign-in link (REQUIRED in the body, so a message can never go out without it)
export const PLACEHOLDERS = ["{first_name}", "{coach_name}", "{link}"] as const;
export const SUBJECT_MAX = 150;
export const BODY_MAX = 2000;

export const DEFAULT_CLAIM_SUBJECT = "{coach_name} invited you to Spotlight Coaching";
export const DEFAULT_CLAIM_BODY = [
  "Hi {first_name},",
  "",
  "{coach_name} set up your training in Spotlight Coaching. Tap this link to sign in and get started:",
  "",
  "{link}",
  "",
  `The link works once and expires in ${CLAIM_LINK_LIFETIME_HOURS} hours. If you weren't expecting this, you can ignore this email.`,
].join("\n");

export interface MessageTemplate {
  subject: string;
  body: string;
}

export const DEFAULT_CLAIM_TEMPLATE: MessageTemplate = { subject: DEFAULT_CLAIM_SUBJECT, body: DEFAULT_CLAIM_BODY };

// Plain text only: control characters (except line breaks in the body) are dropped, and the subject is one line.
function clean(text: string, multiline: boolean): string {
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return multiline ? stripped : stripped.replace(/\s*\n\s*/g, " ").trim();
}

export function validateTemplate(input: { subject: unknown; body: unknown }): { ok: true; template: MessageTemplate } | { ok: false; error: string } {
  if (typeof input.subject !== "string" || typeof input.body !== "string") return { ok: false, error: "Write a subject and a message." };
  const subject = clean(input.subject, false);
  const body = clean(input.body, true).trim();
  if (!subject) return { ok: false, error: "The subject can't be empty." };
  if (!body) return { ok: false, error: "The message can't be empty." };
  if (subject.length > SUBJECT_MAX) return { ok: false, error: `The subject is too long (most ${SUBJECT_MAX} characters).` };
  if (body.length > BODY_MAX) return { ok: false, error: `The message is too long (most ${BODY_MAX} characters).` };
  if (!body.includes("{link}")) return { ok: false, error: "The message needs {link} in it, or your client has no way to sign in." };
  return { ok: true, template: { subject, body } };
}

// Fills the placeholders. Only these three are ever replaced; any other {text} stays exactly as written. A missing name reads naturally.
export function renderTemplate(template: MessageTemplate, values: { firstName: string; coachName: string | null; link: string }): { subject: string; text: string } {
  const firstName = values.firstName.trim() || "there";
  const coachName = values.coachName?.trim() || "Your coach";
  const fill = (s: string) =>
    s
      .split("{first_name}").join(firstName)
      .split("{coach_name}").join(coachName)
      .split("{link}").join(values.link);
  return { subject: clean(fill(template.subject), false), text: fill(template.body) };
}
