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
  | "quiet_hours"
  | "already_sent"
  | "send_failed";

export interface SmsDispatchResult {
  sent: boolean;
  reason?: SmsDispatchReason;
}

// The single call point every SMS trigger in this app goes through —
// crons, event-fired API routes, all of it. Centralizing the opt-in +
// quiet-hours + idempotency checks here means no call site can forget
// one; a new trigger only ever has to build the message and call this.
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
    recipientPhone: string | null | undefined;
    messageType: SmsMessageType;
    referenceId: string;
    body: string;
  }
): Promise<SmsDispatchResult> {
  if (!isTwilioConfigured()) return { sent: false, reason: "twilio_not_configured" };
  if (!params.recipientPhone) return { sent: false, reason: "no_phone" };

  const normalizedPhone = normalizePhoneToE164(params.recipientPhone);
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
