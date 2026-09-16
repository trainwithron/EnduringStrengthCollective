// Fire-and-forget browser-side call, same shape as lib/push-notify.ts's
// notifyPush — mirrors one booking into the coach's Google work
// calendar (if connected) right after book_session/reschedule_booking/
// cancel_booking_and_refund_credit succeeds. Never blocks or surfaces
// an error into the booking flow itself; the actual booking already
// happened before this is called.
export function mirrorGoogleCalendarEvent(bookingId: string) {
  fetch("/api/google-calendar/mirror-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId }),
  }).catch(() => {});
}
