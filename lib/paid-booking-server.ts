import { getStripeClient } from "@/lib/stripe";
import { publicBookingStore } from "@/lib/public-booking-store";
import { sendCoachPush } from "@/lib/coach-notice";
import { notifyPaymentReceived } from "@/lib/notify-payment";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { dollars, type PaidDeps } from "@/lib/paid-booking";

// The real pieces behind lib/paid-booking.ts: Stripe, the booking store, email and the coach's notices. Service role throughout (a visitor has no account).
export function paidBookingDeps(db: any, origin: string): PaidDeps {
  const base = origin;
  return {
    db,
    store: publicBookingStore(db),
    async refund({ paymentIntentId, stripeAccount, idempotencyKey }) {
      try {
        const r = await getStripeClient().refunds.create({ payment_intent: paymentIntentId, refund_application_fee: true }, { stripeAccount, idempotencyKey });
        return { ok: true, refundId: r.id };
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        return { ok: false, alreadyRefunded: code === "charge_already_refunded", message: err instanceof Error ? err.message : String(err) };
      }
    },
    async sendEmail(to, subject, text) {
      return isEmailConfigured() ? sendEmail(to, subject, text) : false;
    },
    async tellCoach({ coachId, groupId, body, title, link }) {
      const { error } = await db.from("notifications").insert({ profile_id: coachId, group_id: groupId, type: "payment_problem", body, link_path: link, pushed_at: new Date().toISOString() });
      if (error) console.error("[paid booking] the refund notice was refused:", error.message);
      // the lock screen says only that a refund was made; the notice has who and how much
      await sendCoachPush(db, coachId, "payments", title, "Open the app to see the details.", link).catch(() => 0);
    },
    async paymentReceived(args) {
      await notifyPaymentReceived(db, args);
    },
    async bookedEmail({ to, guestName, coachName, typeName, startIso, timezone, manageToken, bookingId }) {
      if (!isEmailConfigured()) return;
      const when = formatInTimezone(new Date(startIso), timezone, "dateTime");
      const manageUrl = `${base}/book/manage/${manageToken}`;
      const sent = await sendEmail(
        to,
        `Your session with ${coachName} is booked`,
        `Hi ${guestName},\n\nYou paid and your ${typeName} with ${coachName} is booked for ${when}.\n\nNeed to change it or cancel? Use this private link:\n${manageUrl}\n\nSee you then.`
      );
      if (sent) await db.from("booking_manage_links").update({ email_sent_at: new Date().toISOString() }).eq("booking_id", bookingId);
    },
    async coachBookedPush({ coachId, groupId, guestName, typeName, startIso, timezone, amountCents }) {
      const when = formatInTimezone(new Date(startIso), timezone, "dateTime");
      await sendCoachPush(db, coachId, "bookings", "New paid booking", `${guestName} booked and paid ${dollars(amountCents)} for ${typeName} on ${when}.`, `/groups/${groupId}/calendar`);
    },
  };
}
