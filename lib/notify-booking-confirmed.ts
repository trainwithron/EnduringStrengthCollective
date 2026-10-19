
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
  // The phone alert, and an email when no phone was reached, are sent by the server (it re-reads the booking, the names and the client's time zone itself).
  fetch("/api/bookings/confirmed-notice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ athleteId, groupId, startAt }),
    keepalive: true,
  }).catch(() => {});

  fetch("/api/sms/booking-confirmation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ athleteId, groupId, startAt }),
    keepalive: true,
  }).catch(() => {});
}
