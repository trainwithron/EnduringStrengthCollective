import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms, isTwilioConfigured } from "@/lib/twilio";
import { normalizePhoneToE164 } from "@/lib/phone";
import { isWithinQuietHours } from "@/lib/quiet-hours";
import { nowInZone, DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";

export type SmsMessageType =
  | "session_reminder"
  | "booking_confirmation"
  | "attendance_nudge"
  | "low_credit_alert";

export type SmsDispatchReason =
  | "twilio_not_configured"
  | "no_phone"
  | "invalid_phone"
  | "not_opted_in"
  | "no_consent"
  | "opted_out"
  | "minor_no_guardian_consent"
  | "quiet_hours"
  | "already_sent"
  | "send_failed";

export interface SmsDispatchResult {
  sent: boolean;
  reason?: SmsDispatchReason;
}

// What the client consented to (athlete_sms_consent, migration 0229):
//   appointments  = booking confirmations + session reminders
//   announcements = check-ins/nudges (and announcements, later)
// "coach_only" messages go to the coach's own phone, not a client, so
// they need no client consent.
export type SmsConsentScope = "appointments" | "announcements" | "coach_only";

const CONSENT_SCOPE: Record<SmsMessageType, SmsConsentScope> = {
  booking_confirmation: "appointments",
  session_reminder: "appointments",
  attendance_nudge: "announcements",
  low_credit_alert: "coach_only",
};

export function consentScopeFor(messageType: SmsMessageType): SmsConsentScope {
  return CONSENT_SCOPE[messageType];
}

// The single call point every SMS trigger in this app goes through —
// crons, event-fired API routes, all of it. Centralizing the consent +
// opt-in + quiet-hours + idempotency checks here means no call site can
// forget one; a new trigger only ever has to build the message and call
// this.
//
// Client-facing messages FAIL CLOSED: the caller passes the athlete, not a
// phone number, and the number texted is the one that athlete consented to
// (never an athlete-typed profile field). No athleteId, no consent row, the
// wrong scope, a STOP reply, or an under-13 athlete without verified
// guardian consent all mean no text. The Supabase client must be the
// service-role one (the consent check is a service-role-only function; any
// error from it also fails closed).
//
// Insert-then-send, not send-then-log: sms_log's own unique
// (message_type, reference_id) constraint is the real idempotency
// guard, so the insert has to happen BEFORE the Twilio call. A race
// between two cron ticks (or a retried request) fails the loser's
// insert and it never reaches Twilio at all — same "insert first as
// the guard" shape already used for credit_purchases' stripe_event_id.
export async function dispatchSms(
  supabase: SupabaseClient,
  params: {
    coachId: string;
    messageType: SmsMessageType;
    referenceId: string;
    body: string;
    // Client-facing types: who is being texted.
    athleteId?: string | null;
    // coach_only types: the coach's own phone.
    recipientPhone?: string | null;
  }
): Promise<SmsDispatchResult> {
  if (!isTwilioConfigured()) return { sent: false, reason: "twilio_not_configured" };

  const scope = consentScopeFor(params.messageType);
  let phoneToText: string | null | undefined;

  if (scope === "coach_only") {
    phoneToText = params.recipientPhone;
  } else {
    if (!params.athleteId) return { sent: false, reason: "no_consent" };
    const { data, error } = await supabase.rpc("sms_consent_for_dispatch", {
      p_athlete_id: params.athleteId,
      p_scope: scope,
    });
    const row = (Array.isArray(data) ? data[0] : data) as
      | { phone_e164: string | null; allowed: boolean; reason: string | null }
      | null
      | undefined;
    if (error || !row || !row.allowed) {
      const reason = row?.reason;
      return {
        sent: false,
        reason: reason === "opted_out" || reason === "minor_no_guardian_consent" ? reason : "no_consent",
      };
    }
    phoneToText = row.phone_e164;
  }

  if (!phoneToText) return { sent: false, reason: "no_phone" };

  const normalizedPhone = normalizePhoneToE164(phoneToText);
  if (!normalizedPhone) return { sent: false, reason: "invalid_phone" };

  const { data: config } = await supabase
    .from("coach_sms_config")
    .select("sms_enabled, quiet_hours_start, quiet_hours_end")
    .eq("coach_id", params.coachId)
    .maybeSingle();

  if (!config?.sms_enabled) return { sent: false, reason: "not_opted_in" };

  const { data: coachProfile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", params.coachId)
    .maybeSingle();
  const zone = (coachProfile as { timezone?: string } | null)?.timezone ?? DEFAULT_COACH_TIMEZONE;

  if (isWithinQuietHours(nowInZone(zone), config.quiet_hours_start, config.quiet_hours_end)) {
    return { sent: false, reason: "quiet_hours" };
  }

  const { error: logError } = await supabase.from("sms_log").insert({
    coach_id: params.coachId,
    recipient_phone: normalizedPhone,
    message_type: params.messageType,
    reference_id: params.referenceId,
    body: params.body,
  });
  if (logError) return { sent: false, reason: "already_sent" };

  const ok = await sendSms(normalizedPhone, params.body);
  return { sent: ok, reason: ok ? undefined : "send_failed" };
}
