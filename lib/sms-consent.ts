import { normalizePhoneToE164 } from "@/lib/phone";

// Bump this whenever the disclosure wording below changes, so the audit
// trail (sms_consent_events.disclosure_version) records exactly which
// wording each person agreed to.
export const SMS_DISCLOSURE_VERSION = "2026-10-05";

export const SMS_DISCLOSURE_TEXT =
  "Message frequency varies. Message and data rates may apply. Reply STOP to cancel at any time " +
  "(this stops all of these texts), HELP for help. Agreeing is not required to use the app or to " +
  "train with your coach, and you can change this any time here.";

export const SMS_SCOPE_LABELS = {
  appointments: {
    title: "Appointments",
    detail: "Booking confirmations and session reminders.",
  },
  announcements: {
    title: "Check-ins and announcements",
    detail: "A friendly nudge if it's been a while, and messages your coach sends to all clients.",
  },
} as const;

export interface SmsConsentInput {
  phone: string;
  appointments: boolean;
  announcements: boolean;
}

export type ParsedSmsConsent =
  | { ok: true; phoneE164: string; appointments: boolean; announcements: boolean }
  | { ok: false; error: string };

export function parseSmsConsentInput(input: unknown): ParsedSmsConsent {
  const body = (input ?? {}) as Partial<SmsConsentInput>;
  if (typeof body.appointments !== "boolean" || typeof body.announcements !== "boolean") {
    return { ok: false, error: "Choose which texts you want." };
  }
  const phoneE164 = typeof body.phone === "string" ? normalizePhoneToE164(body.phone) : null;
  if (!phoneE164) return { ok: false, error: "Enter a valid mobile number, like (555) 123-4567." };
  return { ok: true, phoneE164, appointments: body.appointments, announcements: body.announcements };
}
