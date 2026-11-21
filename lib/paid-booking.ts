import { commitPublicBooking, type PublicBookingStore } from "@/lib/public-booking-engine";
import { firstNameOnly } from "@/lib/ical-feed";
import { dollars } from "@/lib/paid-booking-money";

// Paid booking on a coach's public page (Ron, Nov 20, wave 3 C7). The money rules, in one place:
//   * "Pay and book" holds the time (public_booking_holds) while the visitor pays by card through the organization's own Stripe account. Nothing is booked yet.
//   * A paid checkout claims its hold ONCE (a repeated Stripe event changes nothing), and only then makes the client record, the booking and the private link.
//   * If the time was taken meanwhile, or the booking cannot be made, the payment is refunded in full at once and the visitor is told.
//   * A payment that never happens leaves nothing: the hold lapses and the visitor's details on it are wiped.
//   * Later, refunds follow the cancel rules (refundDecision), checked every five minutes by the booking job, so every way a session can be cancelled is covered.
//   * Every refund is claimed on its hold first and recorded with Stripe's refund id: two runs at once, or a run after a crash, never refund twice.
//   * Every payment and every refund is told to the coach (a notice and a push); every refund is emailed to the visitor.

export const PURCHASE_KIND = "public_booking";
export const CHECKOUT_MINUTES = 31; // Stripe's shortest checkout life is 30 minutes
export const HOLD_MINUTES = 33; // a little longer than the checkout, so a payment finished in its last second still finds its hold
export const STUCK_CLAIM_MINUTES = 10;
export const REFUND_CLAIM_STALE_MINUTES = 15;
export const SWEEP_LOOKBACK_DAYS = 45;

export type RefundDecision = { kind: "refund"; reason: string } | { kind: "keep" } | { kind: "wait" } | { kind: "nothing" };

export interface BookingState {
  status: string;
  late_cancel: boolean | null;
  late_charge_state: string | null;
}

/** What happens to the money for a paid session, by the same rules as a session credit. */
export function refundDecision(b: BookingState | null): RefundDecision {
  if (!b) return { kind: "refund", reason: "the session was removed" };
  if (b.status !== "cancelled") return { kind: "nothing" };
  if (b.late_cancel) {
    if (b.late_charge_state === "flagged") return { kind: "wait" };
    if (b.late_charge_state === "waived") return { kind: "refund", reason: "late cancel, you let it go" };
    return { kind: "keep" };
  }
  return { kind: "refund", reason: "cancelled in time" };
}

export { dollars };

export function refundNoticeLine(amountCents: number, guestName: string | null, reason: string): string {
  const who = firstNameOnly(guestName) || "your visitor";
  return `Refunded ${dollars(amountCents)} to ${who}: ${reason}.`;
}

export function refundEmail(amountCents: number, coachName: string, why: "taken" | "failed" | "cancelled" | "late"): { subject: string; text: string } {
  const amount = dollars(amountCents);
  const lead =
    why === "taken"
      ? `The time you paid for was taken just before your payment went through, so nothing was booked.`
      : why === "failed"
        ? `We couldn't finish your booking with ${coachName}, so nothing was booked.`
        : why === "late"
          ? `Your payment came in after the time was released, so nothing was booked.`
          : `Your session with ${coachName} was cancelled.`;
  return {
    subject: `Your ${amount} refund`,
    text: `${lead}\n\nWe refunded ${amount} to your card. It usually shows within 5 to 10 business days.${why === "cancelled" ? "" : `\n\nYou're welcome to pick another time on ${coachName}'s booking page.`}`,
  };
}

export interface HoldRow {
  id: string;
  coach_id: string;
  session_type_id: string;
  organization_id: string;
  start_at: string;
  end_at: string;
  expires_at: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  note: string | null;
  amount_cents: number;
  stripe_account_id: string;
  checkout_session_id: string | null;
  state: "open" | "claimed" | "booked" | "refunded" | "lapsed";
  claimed_at: string | null;
  booking_id: string | null;
  manage_link_id: string | null;
  group_id: string | null;
  athlete_id: string | null;
  payment_intent_id: string | null;
  refund_id: string | null;
}

export interface PaidDeps {
  db: any;
  store: PublicBookingStore;
  /** A full refund of this payment on the coach's own Stripe account; the same key every time for one hold. Returns Stripe's refund id. */
  refund(args: { paymentIntentId: string; stripeAccount: string; idempotencyKey: string }): Promise<{ ok: true; refundId: string } | { ok: false; alreadyRefunded: boolean; message: string }>;
  sendEmail(to: string, subject: string, text: string): Promise<boolean>;
  /** The coach is told: a notice in the app and a push. */
  tellCoach(args: { coachId: string; groupId: string | null; body: string; title: string; link: string }): Promise<void>;
  paymentReceived(args: { groupId: string; athleteId: string; amountCents: number; what: string }): Promise<void>;
  bookedEmail(args: { to: string; guestName: string; coachName: string; typeName: string; startIso: string; timezone: string; manageToken: string; bookingId: string }): Promise<void>;
  coachBookedPush(args: { coachId: string; groupId: string; guestName: string; typeName: string; startIso: string; timezone: string; amountCents: number }): Promise<void>;
  now?: () => Date;
}

const nowOf = (d: PaidDeps) => (d.now ? d.now() : new Date());

// ---- refunds ---------------------------------------------------------------------------------------------------------

/**
 * Refunds one hold's payment in full, at most once. The hold is claimed first (only a run that wins the claim goes on; a claim left by a crash is taken over after 15 minutes),
 * Stripe is asked with the same key every time, and the refund id is stored. A refund Stripe says already happened is recorded as done, never repeated.
 */
export async function refundHold(deps: PaidDeps, hold: HoldRow, reason: string, emailWhy: "taken" | "failed" | "cancelled" | "late", visitorEmail?: string | null): Promise<"refunded" | "skipped" | "failed"> {
  if (hold.refund_id || !hold.payment_intent_id) return "skipped";
  const now = nowOf(deps);
  const stale = new Date(now.getTime() - REFUND_CLAIM_STALE_MINUTES * 60000).toISOString();
  const { data: claimed, error: claimError } = await deps.db
    .from("public_booking_holds")
    .update({ refund_claimed_at: now.toISOString() })
    .eq("id", hold.id)
    .is("refund_id", null)
    .or(`refund_claimed_at.is.null,refund_claimed_at.lt.${stale}`)
    .select("id");
  if (claimError || !claimed || claimed.length !== 1) return "skipped";

  const result = await deps.refund({ paymentIntentId: hold.payment_intent_id, stripeAccount: hold.stripe_account_id, idempotencyKey: `public-booking-refund-${hold.id}` });
  if (!result.ok && !result.alreadyRefunded) {
    // let the next run try again
    await deps.db.from("public_booking_holds").update({ refund_claimed_at: null }).eq("id", hold.id);
    console.error("[paid booking] refund failed; will retry:", result.message);
    return "failed";
  }
  const refundId = result.ok ? result.refundId : `already-${hold.id}`;
  const { error: recordError } = await deps.db
    .from("public_booking_holds")
    .update({ state: "refunded", refund_id: refundId, refunded_at: now.toISOString(), refund_reason: reason })
    .eq("id", hold.id);
  // The money has gone back either way; if the record failed, the claim stays and the same key makes a retry a no-op at Stripe.
  if (recordError) console.error("[paid booking] refund recorded late:", recordError.message);

  const coachName = await coachNameOf(deps.db, hold.coach_id);
  await deps
    .tellCoach({ coachId: hold.coach_id, groupId: hold.group_id, title: "A refund was made", body: refundNoticeLine(hold.amount_cents, hold.guest_name, reason), link: hold.group_id ? `/groups/${hold.group_id}/business` : "/dashboard" })
    .catch(() => {});
  const to = hold.guest_email ?? visitorEmail ?? null;
  if (to) {
    const mail = refundEmail(hold.amount_cents, coachName, emailWhy);
    await deps.sendEmail(to, mail.subject, mail.text).catch(() => false);
  }
  return "refunded";
}

async function coachNameOf(db: any, coachId: string): Promise<string> {
  const { data } = await db.from("profiles").select("full_name").eq("id", coachId).maybeSingle();
  return (data as { full_name?: string } | null)?.full_name ?? "your coach";
}

// ---- a paid checkout -------------------------------------------------------------------------------------------------

export interface PaidCheckout {
  holdId: string | null;
  paymentIntentId: string | null;
  paid: boolean;
  eventAccount: string | null;
  customerEmail: string | null;
}

export type PaidOutcome = "booked" | "duplicate" | "refunded" | "ignored" | "unpaid";

/** Handles checkout.session.completed for a public booking. A thrown error makes Stripe send the event again. */
export async function handlePaidCheckout(deps: PaidDeps, c: PaidCheckout): Promise<PaidOutcome> {
  if (!c.paid) return "unpaid";
  if (!c.holdId || !c.paymentIntentId) return "ignored";
  const { data: found, error: readError } = await deps.db.from("public_booking_holds").select("*").eq("id", c.holdId).maybeSingle();
  if (readError) throw new Error("could not read the hold");
  const hold = found as HoldRow | null;
  if (!hold) {
    // The coach's account was removed meanwhile (the hold went with it): the money still goes back.
    if (c.eventAccount) {
      await deps.refund({ paymentIntentId: c.paymentIntentId, stripeAccount: c.eventAccount, idempotencyKey: `public-booking-refund-${c.holdId}` });
    }
    return "refunded";
  }
  if (c.eventAccount && c.eventAccount !== hold.stripe_account_id) {
    console.error("[paid booking] ignored a payment from another account", c.eventAccount, hold.id);
    return "ignored";
  }

  const now = nowOf(deps);
  const { data: claimed, error: claimError } = await deps.db
    .from("public_booking_holds")
    .update({ state: "claimed", claimed_at: now.toISOString(), payment_intent_id: c.paymentIntentId })
    .eq("id", hold.id)
    .eq("state", "open")
    .select("id");
  if (claimError) throw new Error("could not claim the hold");
  if (!claimed || claimed.length !== 1) {
    // Already handled (a repeated event), or the hold had ended before the payment: then the money goes back.
    if (hold.state === "lapsed" && !hold.payment_intent_id) {
      await deps.db.from("public_booking_holds").update({ payment_intent_id: c.paymentIntentId }).eq("id", hold.id).is("payment_intent_id", null);
      return (await refundHold(deps, { ...hold, payment_intent_id: c.paymentIntentId }, "the payment came after the time was released", "late", c.customerEmail)) === "failed"
        ? Promise.reject(new Error("refund failed"))
        : "refunded";
    }
    return "duplicate";
  }
  const mine: HoldRow = { ...hold, state: "claimed", claimed_at: now.toISOString(), payment_intent_id: c.paymentIntentId };

  const fail = async (reason: string, why: "taken" | "failed") => {
    const r = await refundHold(deps, mine, reason, why, c.customerEmail);
    if (r === "failed") throw new Error("refund failed"); // Stripe sends the event again; the claim stays, the sweep also retries
    return "refunded" as const;
  };

  const { data: pageRow } = await deps.db.from("coach_booking_pages").select("slug").eq("coach_id", hold.coach_id).maybeSingle();
  const page = pageRow?.slug ? await deps.store.pageBySlug(pageRow.slug as string) : null;
  const type = page ? (await deps.store.sessionTypes(hold.coach_id)).find((t) => t.id === hold.session_type_id) : null;
  if (!page || !type || !hold.guest_name || !hold.guest_email) return fail("the booking could not be made", "failed");

  const start = new Date(hold.start_at);
  const end = new Date(hold.end_at);
  // Only whether the time is still free: the visitor paid while it was offered, so notice and open hours are not checked again.
  const busy = await deps.store.busy(hold.coach_id, new Date(start.getTime() - 86400000), new Date(end.getTime() + 86400000), hold.id);
  if (busy.some((b) => b.start < end && b.end > start)) return fail("the time was taken before the payment went through", "taken");

  const ctx = await deps.store.coachContext(hold.coach_id);
  const result = await commitPublicBooking(
    deps.store,
    { page, type, guest: { name: hold.guest_name, email: hold.guest_email, phone: hold.guest_phone, note: hold.note }, start, end, timezone: ctx.timezone },
    { countNewGuest: false }
  );
  if (!result.ok) return fail(result.status === 409 ? "the time was taken before the payment went through" : "the booking could not be made", result.status === 409 ? "taken" : "failed");

  const record = { state: "booked", booking_id: result.bookingId, manage_link_id: result.linkId ?? null, group_id: result.groupId, athlete_id: await athleteOf(deps.db, result.bookingId) };
  let { error: bookedError } = await deps.db.from("public_booking_holds").update(record).eq("id", hold.id);
  if (bookedError) ({ error: bookedError } = await deps.db.from("public_booking_holds").update(record).eq("id", hold.id));
  if (bookedError) {
    // Without the record the payment could never follow the session: undo the booking and give the money back rather than leave either one loose.
    await deps.store.cancel(result.bookingId);
    return fail("the booking could not be made", "failed");
  }

  await deps.bookedEmail({ to: hold.guest_email, guestName: hold.guest_name, coachName: page.coachName, typeName: type.name, startIso: result.startIso, timezone: result.timezone, manageToken: result.manageToken, bookingId: result.bookingId }).catch(() => {});
  if (record.athlete_id) await deps.paymentReceived({ groupId: result.groupId, athleteId: record.athlete_id, amountCents: hold.amount_cents, what: type.name }).catch(() => {});
  await deps.coachBookedPush({ coachId: hold.coach_id, groupId: result.groupId, guestName: hold.guest_name, typeName: type.name, startIso: result.startIso, timezone: result.timezone, amountCents: hold.amount_cents }).catch(() => {});
  return "booked";
}

async function athleteOf(db: any, bookingId: string): Promise<string | null> {
  const { data } = await db.from("bookings").select("athlete_id").eq("id", bookingId).maybeSingle();
  return (data as { athlete_id?: string } | null)?.athlete_id ?? null;
}

// ---- the five-minute sweep -------------------------------------------------------------------------------------------

export interface SweepResult {
  lapsed: number;
  refunded: number;
  followed: number;
  failed: number;
}

/** Lapses unpaid holds, refunds stuck ones, and applies the cancel rules to paid sessions. Safe to run twice at once. */
export async function runPaidBookingSweep(deps: PaidDeps): Promise<SweepResult> {
  const now = nowOf(deps);
  const out: SweepResult = { lapsed: 0, refunded: 0, followed: 0, failed: 0 };

  // 1. An unpaid hold that ran out: gone, and the visitor's details with it.
  const { data: lapsed, error: lapseError } = await deps.db
    .from("public_booking_holds")
    .update({ state: "lapsed", guest_name: null, guest_email: null, guest_phone: null, note: null })
    .eq("state", "open")
    .lt("expires_at", now.toISOString())
    .select("id");
  if (lapseError) {
    // before step 218 there is no table: nothing to do
    if (/relation|does not exist|schema cache/i.test(lapseError.message ?? "")) return out;
    throw new Error("could not lapse holds");
  }
  out.lapsed = (lapsed ?? []).length;

  // 2. A paid hold that never became a booking (the server stopped half way): the money goes back.
  const stuckBefore = new Date(now.getTime() - STUCK_CLAIM_MINUTES * 60000).toISOString();
  const { data: stuck } = await deps.db.from("public_booking_holds").select("*").eq("state", "claimed").is("booking_id", null).lt("claimed_at", stuckBefore).limit(50);
  for (const h of (stuck ?? []) as HoldRow[]) {
    const r = await refundHold(deps, h, "the booking could not be finished", "failed");
    if (r === "refunded") out.refunded++;
    if (r === "failed") out.failed++;
  }

  // 3. Paid sessions: the cancel rules.
  const since = new Date(now.getTime() - SWEEP_LOOKBACK_DAYS * 86400000).toISOString();
  const { data: booked, error: bookedError } = await deps.db
    .from("public_booking_holds")
    .select("*, bookings!public_booking_holds_booking_id_fkey ( status, late_cancel, late_charge_state, athlete_id, coach_id ), booking_manage_links!public_booking_holds_manage_link_id_fkey ( booking_id )")
    .eq("state", "booked")
    .is("refund_id", null)
    .gte("start_at", since)
    .order("id")
    .limit(500);
  if (bookedError) throw new Error("could not read paid sessions");
  for (const row of (booked ?? []) as (HoldRow & { bookings: any; booking_manage_links: any })[]) {
    const b = Array.isArray(row.bookings) ? row.bookings[0] : row.bookings;
    const link = Array.isArray(row.booking_manage_links) ? row.booking_manage_links[0] : row.booking_manage_links;
    if (b && b.status === "cancelled") {
      // A moved session is a new booking: the payment follows it instead of going back.
      const moved = await movedTo(deps.db, row, b, link?.booking_id ?? null);
      if (moved) {
        await deps.db.from("public_booking_holds").update({ booking_id: moved }).eq("id", row.id).eq("booking_id", row.booking_id);
        out.followed++;
        continue;
      }
    }
    const d = refundDecision(b ? { status: b.status, late_cancel: b.late_cancel, late_charge_state: b.late_charge_state } : null);
    if (d.kind !== "refund") continue;
    const r = await refundHold(deps, row, d.reason, "cancelled");
    if (r === "refunded") out.refunded++;
    if (r === "failed") out.failed++;
  }
  return out;
}

// The booking a cancelled paid session became: the visitor moved it with their private link (the link points at the new one), or a move request was approved.
async function movedTo(db: any, hold: HoldRow, b: { athlete_id: string; coach_id: string }, linkBookingId: string | null): Promise<string | null> {
  if (linkBookingId && linkBookingId !== hold.booking_id) {
    const { data } = await db.from("bookings").select("id, status").eq("id", linkBookingId).maybeSingle();
    if (data && (data as { status: string }).status !== "cancelled") return linkBookingId;
  }
  const { data: req } = await db
    .from("booking_requests")
    .select("new_start_at")
    .eq("kind", "move")
    .eq("booking_id", hold.booking_id)
    .eq("status", "confirmed")
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!req?.new_start_at) return null;
  const { data: moved } = await db
    .from("bookings")
    .select("id")
    .eq("athlete_id", b.athlete_id)
    .eq("coach_id", b.coach_id)
    .eq("start_at", req.new_start_at)
    .eq("status", "confirmed")
    .limit(1)
    .maybeSingle();
  return (moved as { id?: string } | null)?.id ?? null;
}
