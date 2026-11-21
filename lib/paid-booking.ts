import { commitPublicBooking, type PublicBookingStore } from "@/lib/public-booking-engine";
import { generateClaimToken, hashClaimToken } from "@/lib/client-claim-token";
import { pageAll } from "@/lib/page-all";
import { firstNameOnly } from "@/lib/ical-feed";
import { dollars } from "@/lib/paid-booking-money";

// Paid booking on a coach's public page (Ron, Nov 20, wave 3 C7). The money rules, in one place:
//   * "Pay and book" holds the time (public_booking_holds) while the visitor pays by card through the organization's own Stripe account. Nothing is booked yet.
//   * A paid checkout claims its hold ONCE (a repeated Stripe event changes nothing), and only then makes the client record, the booking and the private link.
//   * If the time was taken meanwhile, the booking cannot be made, or the amount paid is not the price, the payment is refunded in full at once and the visitor is told.
//   * A payment that never happens leaves nothing: the hold lapses and the visitor's details on it are wiped.
//   * A paid checkout whose server stopped half way is finished by the five-minute job: the booking it made is adopted, and only when there truly is none is it refunded.
//   * Later, refunds follow the cancel rules (refundDecision), checked every five minutes by the booking job, so every way a session can be cancelled is covered. A cancellation
//     must be seen on two runs at least five minutes apart before it is refunded, so a session being moved (cancelled, then booked again) is never refunded in between.
//   * Every refund is claimed on its hold first and recorded with Stripe's refund id: two runs at once, or a run after a crash, never refund twice.
//   * Every payment and every refund is told to the coach (a notice and a push); every refund is emailed to the visitor.

export const PURCHASE_KIND = "public_booking";
export const CHECKOUT_MINUTES = 31; // Stripe's shortest checkout life is 30 minutes
export const HOLD_MINUTES = 33; // two minutes longer than the checkout, so a payment finished in its last second still finds its time held
export const LAPSE_GRACE_MINUTES = 15; // an unpaid hold is wiped this long after its time is released, so a slow Stripe event still finds it
export const STUCK_CLAIM_MINUTES = 10;
export const REFUND_CLAIM_STALE_MINUTES = 15;
export const CANCEL_SEEN_TWICE_MINUTES = 5;
export const SWEEP_LOOKBACK_DAYS = 45;
export const DECISION_FAILURES_ALERT = 3;

export type RefundDecision = { kind: "refund"; reason: string } | { kind: "keep" } | { kind: "wait" } | { kind: "nothing" };

export interface BookingState {
  status: string;
  late_cancel: boolean | null;
  late_charge_state: string | null;
}

/**
 * What happens to the money for a paid session, by the same rules as a session credit. lateMoveCharged: the coach charged this session for a late move earlier (it then
 * stays that visit's one paid session, so the client cancelling it later keeps the money, as it keeps the session). cancelledByCoach: the coach cancelled it, which gives the
 * session back, so the money goes back too.
 */
export function refundDecision(b: BookingState | null, opts: { lateMoveCharged?: boolean; cancelledByCoach?: boolean } = {}): RefundDecision {
  if (!b) return { kind: "refund", reason: "the session was removed" };
  if (b.status !== "cancelled") return { kind: "nothing" };
  if (b.late_cancel) {
    if (b.late_charge_state === "flagged") return { kind: "wait" };
    if (b.late_charge_state === "waived") return { kind: "refund", reason: "late cancel, you let it go" };
    return { kind: "keep" };
  }
  if (opts.lateMoveCharged) return opts.cancelledByCoach ? { kind: "refund", reason: "you cancelled it" } : { kind: "keep" };
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
  refund_candidate_at?: string | null;
  decision_failures?: number;
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
  /** Something that should never happen with money: the platform admin is told at once. */
  alertAdmin(subject: string, body: string): Promise<void>;
  now?: () => Date;
}

const nowOf = (d: PaidDeps) => (d.now ? d.now() : new Date());
const one = (v: any) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

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

// The page and session type a hold was for. Read again when the booking is made, so the names in the email are today's.
async function pageAndType(deps: PaidDeps, hold: HoldRow) {
  const { data: pageRow } = await deps.db.from("coach_booking_pages").select("slug").eq("coach_id", hold.coach_id).maybeSingle();
  const page = pageRow?.slug ? await deps.store.pageBySlug(pageRow.slug as string) : null;
  const type = page ? ((await deps.store.sessionTypes(hold.coach_id)).find((t) => t.id === hold.session_type_id) ?? null) : null;
  return { page, type };
}

// The visitor gets their private link, the coach their payment notice and push. Best effort: the booking is already made.
async function tellBooked(deps: PaidDeps, hold: HoldRow, b: { bookingId: string; groupId: string; athleteId: string | null; manageToken: string; coachName: string; typeName: string; timezone: string }) {
  if (hold.guest_email && hold.guest_name) {
    await deps
      .bookedEmail({ to: hold.guest_email, guestName: hold.guest_name, coachName: b.coachName, typeName: b.typeName, startIso: new Date(hold.start_at).toISOString(), timezone: b.timezone, manageToken: b.manageToken, bookingId: b.bookingId })
      .catch(() => {});
  }
  if (b.athleteId) await deps.paymentReceived({ groupId: b.groupId, athleteId: b.athleteId, amountCents: hold.amount_cents, what: b.typeName }).catch(() => {});
  await deps
    .coachBookedPush({ coachId: hold.coach_id, groupId: b.groupId, guestName: hold.guest_name ?? "A visitor", typeName: b.typeName, startIso: new Date(hold.start_at).toISOString(), timezone: b.timezone, amountCents: hold.amount_cents })
    .catch(() => {});
}

// ---- a paid checkout -------------------------------------------------------------------------------------------------

export interface PaidCheckout {
  holdId: string | null;
  paymentIntentId: string | null;
  paid: boolean;
  eventAccount: string | null;
  customerEmail: string | null;
  /** What Stripe says was paid: it must be the hold's price, in dollars. */
  amountTotal: number | null;
  currency: string | null;
}

export type PaidOutcome = "booked" | "duplicate" | "refunded" | "ignored" | "unpaid";

/** Handles checkout.session.completed for a public booking. A thrown error makes Stripe send the event again. */
export async function handlePaidCheckout(deps: PaidDeps, c: PaidCheckout): Promise<PaidOutcome> {
  if (!c.paid) return "unpaid";
  if (!c.holdId || !c.paymentIntentId) return "ignored";
  const readHold = async () => {
    const { data, error } = await deps.db.from("public_booking_holds").select("*").eq("id", c.holdId).maybeSingle();
    if (error) throw new Error("could not read the hold");
    return data as HoldRow | null;
  };
  const hold = await readHold();
  if (!hold) {
    // The coach's account was removed meanwhile (the hold went with it): the money still goes back. A refund that fails is thrown, so Stripe sends the event again.
    if (c.eventAccount) {
      const r = await deps.refund({ paymentIntentId: c.paymentIntentId, stripeAccount: c.eventAccount, idempotencyKey: `public-booking-refund-${c.holdId}` });
      if (!r.ok && !r.alreadyRefunded) throw new Error("refund failed");
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
    // Someone else has it, or the hold ended before the payment. Decided on the hold as it is NOW (it may have lapsed since the first read).
    const fresh = await readHold();
    if (fresh && fresh.state === "lapsed" && !fresh.payment_intent_id) {
      const { data: tagged } = await deps.db.from("public_booking_holds").update({ payment_intent_id: c.paymentIntentId }).eq("id", fresh.id).is("payment_intent_id", null).select("id");
      if (!tagged || tagged.length !== 1) return "duplicate"; // another delivery of this event got there first and is refunding it
      const r = await refundHold(deps, { ...fresh, payment_intent_id: c.paymentIntentId }, "the payment came after the time was released", "late", c.customerEmail);
      if (r === "failed") throw new Error("refund failed");
      return "refunded";
    }
    return "duplicate";
  }
  const mine: HoldRow = { ...hold, state: "claimed", claimed_at: now.toISOString(), payment_intent_id: c.paymentIntentId };

  const fail = async (reason: string, why: "taken" | "failed") => {
    const r = await refundHold(deps, mine, reason, why, c.customerEmail);
    if (r === "failed") throw new Error("refund failed"); // Stripe sends the event again; the claim stays, the sweep also retries
    return "refunded" as const;
  };

  // The amount is set by the server when checkout starts; anything else paid is refunded and the admin is told.
  if (c.amountTotal !== hold.amount_cents || (c.currency ?? "").toLowerCase() !== "usd") {
    await deps.alertAdmin("Paid booking: wrong amount", `Hold ${hold.id}: Stripe says ${c.amountTotal ?? "?"} ${c.currency ?? "?"}, the price was ${hold.amount_cents} usd. Refunded.`).catch(() => {});
    return fail("the amount paid did not match the price", "failed");
  }

  const { page, type } = await pageAndType(deps, hold);
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

  const athleteId = await athleteOf(deps.db, result.bookingId);
  const { error: bookedError } = await deps.db
    .from("public_booking_holds")
    .update({ state: "booked", booking_id: result.bookingId, manage_link_id: result.linkId ?? null, group_id: result.groupId, athlete_id: athleteId })
    .eq("id", hold.id)
    .eq("state", "claimed");
  // The booking is made and paid for; only its record on the hold failed. Nothing is undone: the five-minute job finds this booking and adopts it (adoptMadeBooking).
  if (bookedError) throw new Error("could not record the booking on its hold");

  await tellBooked(deps, mine, { bookingId: result.bookingId, groupId: result.groupId, athleteId, manageToken: result.manageToken, coachName: page.coachName, typeName: type.name, timezone: result.timezone });
  return "booked";
}

async function athleteOf(db: any, bookingId: string): Promise<string | null> {
  const { data } = await db.from("bookings").select("athlete_id").eq("id", bookingId).maybeSingle();
  return (data as { athlete_id?: string } | null)?.athlete_id ?? null;
}

/**
 * A paid hold whose server stopped after the booking was made but before it was recorded: find the booking it made (this coach, this visitor's email, a link made after the claim,
 * at the held time, still on) and adopt it. The visitor never got their private link, so a new one is made and emailed. "unknown" when the lookup failed: decide next run.
 */
export async function adoptMadeBooking(deps: PaidDeps, h: HoldRow): Promise<"adopted" | "none" | "unknown"> {
  if (!h.guest_email || !h.claimed_at) return "none";
  const { data: links, error } = await deps.db
    .from("booking_manage_links")
    .select("id, booking_id, athlete_id, created_at, bookings!booking_manage_links_booking_id_fkey ( id, start_at, status, group_id )")
    .eq("coach_id", h.coach_id)
    .eq("guest_email", h.guest_email)
    // five minutes of slack: the claim's time is the app server's clock, the link's the database's (nobody else can hold this time, so nothing else can match)
    .gte("created_at", new Date(Date.parse(h.claimed_at) - 5 * 60000).toISOString())
    .limit(20);
  if (error) return "unknown";
  const match = ((links ?? []) as any[]).find((l) => {
    const b = one(l.bookings);
    return b && b.status === "confirmed" && Date.parse(b.start_at) === Date.parse(h.start_at);
  });
  if (!match) return "none";
  const b = one(match.bookings);
  const { data: adopted, error: adoptError } = await deps.db
    .from("public_booking_holds")
    .update({ state: "booked", booking_id: b.id, manage_link_id: match.id, group_id: b.group_id, athlete_id: match.athlete_id })
    .eq("id", h.id)
    .eq("state", "claimed")
    .is("booking_id", null)
    .select("id");
  if (adoptError) return "unknown";
  if (!adopted || adopted.length !== 1) return "adopted"; // another run adopted it
  const token = generateClaimToken();
  await deps.db.from("booking_manage_links").update({ token_hash: hashClaimToken(token) }).eq("id", match.id);
  const { page, type } = await pageAndType(deps, h);
  const ctx = await deps.store.coachContext(h.coach_id);
  await tellBooked(deps, h, { bookingId: b.id, groupId: b.group_id, athleteId: match.athlete_id ?? null, manageToken: token, coachName: page?.coachName ?? (await coachNameOf(deps.db, h.coach_id)), typeName: type?.name ?? "session", timezone: ctx.timezone });
  return "adopted";
}

// ---- the five-minute sweep -------------------------------------------------------------------------------------------

export interface SweepResult {
  lapsed: number;
  refunded: number;
  adopted: number;
  followed: number;
  failed: number;
}

const BOOKED_SELECT =
  "*, bookings!public_booking_holds_booking_id_fkey ( status, late_cancel, late_charge_state, athlete_id, coach_id, cancelled_by ), booking_manage_links!public_booking_holds_manage_link_id_fkey ( booking_id )";

/** Lapses unpaid holds, finishes or refunds stuck ones, and applies the cancel rules to paid sessions. Safe to run twice at once. */
export async function runPaidBookingSweep(deps: PaidDeps): Promise<SweepResult> {
  const now = nowOf(deps);
  const out: SweepResult = { lapsed: 0, refunded: 0, adopted: 0, followed: 0, failed: 0 };

  // 1. An unpaid hold whose time was released a while ago: gone, and the visitor's details with it.
  const lapseBefore = new Date(now.getTime() - LAPSE_GRACE_MINUTES * 60000).toISOString();
  const { data: lapsed, error: lapseError } = await deps.db
    .from("public_booking_holds")
    .update({ state: "lapsed", guest_name: null, guest_email: null, guest_phone: null, note: null })
    .eq("state", "open")
    .lt("expires_at", lapseBefore)
    .select("id");
  if (lapseError) {
    // before step 218 there is no table: nothing to do
    if (/relation|does not exist|schema cache/i.test(lapseError.message ?? "")) return out;
    throw new Error("could not lapse holds");
  }
  out.lapsed = (lapsed ?? []).length;

  // 2. A paid hold that was not recorded as booked (the server stopped half way): adopt the booking it made, or, only when there is none, refund.
  const stuckBefore = new Date(now.getTime() - STUCK_CLAIM_MINUTES * 60000).toISOString();
  const { data: stuck, error: stuckError } = await deps.db.from("public_booking_holds").select("*").eq("state", "claimed").is("booking_id", null).lt("claimed_at", stuckBefore).limit(50);
  if (stuckError) throw new Error("could not read unfinished payments");
  for (const h of (stuck ?? []) as HoldRow[]) {
    const found = await adoptMadeBooking(deps, h);
    if (found === "adopted") {
      out.adopted++;
      continue;
    }
    if (found === "unknown") continue;
    const r = await refundHold(deps, h, "the booking could not be finished", "failed");
    if (r === "refunded") out.refunded++;
    if (r === "failed") out.failed++;
  }

  // 2b. A payment that came after its hold lapsed and whose refund has not gone through yet (the first try failed): try again.
  const { data: late, error: lateError } = await deps.db.from("public_booking_holds").select("*").eq("state", "lapsed").not("payment_intent_id", "is", null).is("refund_id", null).limit(50);
  if (lateError) throw new Error("could not read late payments");
  for (const h of (late ?? []) as HoldRow[]) {
    const r = await refundHold(deps, h, "the payment came after the time was released", "late");
    if (r === "refunded") out.refunded++;
    if (r === "failed") out.failed++;
  }

  // 3. Paid sessions that may need the cancel rules: only those whose booking is cancelled or gone, or that were seen cancelled last run. Every one, a page at a time.
  const since = new Date(now.getTime() - SWEEP_LOOKBACK_DAYS * 86400000).toISOString();
  const reads = [
    (a: number, b: number) =>
      deps.db
        .from("public_booking_holds")
        .select(BOOKED_SELECT.replace("bookings!public_booking_holds_booking_id_fkey (", "bookings!public_booking_holds_booking_id_fkey!inner ("))
        .eq("state", "booked")
        .is("refund_id", null)
        .eq("bookings.status", "cancelled")
        .gte("start_at", since)
        .order("id")
        .range(a, b),
    (a: number, b: number) => deps.db.from("public_booking_holds").select(BOOKED_SELECT).eq("state", "booked").is("refund_id", null).is("booking_id", null).order("id").range(a, b),
    (a: number, b: number) => deps.db.from("public_booking_holds").select(BOOKED_SELECT).eq("state", "booked").is("refund_id", null).not("refund_candidate_at", "is", null).order("id").range(a, b),
  ];
  const pages = await Promise.all(reads.map((r) => pageAll(r, { maxPages: 50 })));
  if (pages.some((p) => p.failed)) throw new Error("could not read paid sessions");
  const rows = new Map<string, HoldRow & { bookings: any; booking_manage_links: any }>();
  for (const p of pages) for (const r of p.rows) rows.set(r.id, r);

  for (const row of rows.values()) {
    const b = one(row.bookings);
    const link = one(row.booking_manage_links);
    const clearCandidate = async () => {
      if (row.refund_candidate_at) await deps.db.from("public_booking_holds").update({ refund_candidate_at: null }).eq("id", row.id);
    };
    if (b && b.status === "cancelled") {
      // A moved session is a new booking: the payment follows it instead of going back.
      const moved = await movedTo(deps.db, row, b, link?.booking_id ?? null);
      if (moved) {
        await deps.db.from("public_booking_holds").update({ booking_id: moved, refund_candidate_at: null }).eq("id", row.id).eq("booking_id", row.booking_id);
        out.followed++;
        continue;
      }
    }
    let lateMoveCharged = false;
    if (b && b.status === "cancelled" && !b.late_cancel) {
      const { data: charged, error: chargedError } = await deps.db.rpc("booking_late_move_charged", { p_booking_id: row.booking_id });
      if (chargedError) {
        // unknown: decide next run, never refund on a guess; three runs in a row and the platform admin is told (once)
        const failures = (row.decision_failures ?? 0) + 1;
        await deps.db.from("public_booking_holds").update({ decision_failures: failures }).eq("id", row.id).eq("decision_failures", row.decision_failures ?? 0);
        if (failures === DECISION_FAILURES_ALERT) {
          await deps
            .alertAdmin("Paid booking: refund rule can't be read", `Hold ${row.id} (booking ${row.booking_id}): booking_late_move_charged failed ${failures} runs in a row: ${chargedError.message ?? "unknown error"}. No refund until it can be read.`)
            .catch(() => {});
        }
        out.failed++;
        continue;
      }
      if ((row.decision_failures ?? 0) > 0) await deps.db.from("public_booking_holds").update({ decision_failures: 0 }).eq("id", row.id);
      lateMoveCharged = charged === true;
    }
    const cancelledByCoach = !!b && !!b.cancelled_by && b.cancelled_by !== b.athlete_id;
    const d = refundDecision(b ? { status: b.status, late_cancel: b.late_cancel, late_charge_state: b.late_charge_state } : null, { lateMoveCharged, cancelledByCoach });
    if (d.kind !== "refund") {
      await clearCandidate();
      continue;
    }
    // Seen twice, five minutes apart, before any money moves.
    if (!row.refund_candidate_at) {
      await deps.db.from("public_booking_holds").update({ refund_candidate_at: now.toISOString() }).eq("id", row.id).is("refund_candidate_at", null);
      continue;
    }
    if (now.getTime() - Date.parse(row.refund_candidate_at) < CANCEL_SEEN_TWICE_MINUTES * 60000) continue;
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
