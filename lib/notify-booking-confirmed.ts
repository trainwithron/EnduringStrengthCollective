import { notifyPush } from "@/lib/push-notify";

// acuity_replacement_gap_audit_sept16.md — real gap: zero confirmation/
// reminder infra existed around bookings. This is the confirmation half
// — fired right after book_session() succeeds, same "client already
// knows exactly who it's notifying at the moment it performs the
// action" pattern as checkAndNotifyLowSessionBalance, since Postgres
// triggers here can't make outbound HTTP calls (no pg_net/webhook
// infra — see push-notify.ts's own comment). All three real booking
// call sites (self-book, coach-assign, expanded-day-scheduler) share
// this one function rather than each formatting its own message.
//
// Also fires the SMS mirror (/api/sms/booking-confirmation) — a
// separate, opt-in channel a coach can turn on alongside push, gated
// entirely server-side (coach_sms_config), so this call is fire-and-
// forget exactly like the push call: a coach with SMS off, or no
// Twilio credentials configured at all, just gets a no-op response.
export function notifyBookingConfirmed(athleteId: string, groupId: string, startAt: string) {
  const when = new Date(startAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  notifyPush(
    athleteId,
    "Session confirmed",
    `You're booked for ${when}.`,
    `/groups/${groupId}/calendar`
  );

  fetch("/api/sms/booking-confirmation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ athleteId, groupId, startAt }),
  }).catch(() => {});
}
