import type Stripe from "stripe";
import { sendPushToProfile } from "@/lib/send-push";

// Money events that used to leave no trace in the app (Release M1): a client's failed payment, a refund made in Stripe, a dispute (chargeback) opened and closed. Each is RECORDED (payment_events, one row per Stripe event) and the
// coach who owns the money is told. Nothing else happens: no balance changes, no sessions are taken back, no access ends and no money moves. A refund does not take sessions off the client and a failed payment does not
// end their access; whether either should is the coach's call (and Ron's), listed in docs/NEEDS_RON.md.
// A redelivered event is a harmless duplicate (stripe_event_id is unique). Who the money belongs to is looked up in Stripe BEFORE anything is written: a lookup that FAILS is thrown so Stripe sends the event again (nothing
// is recorded half-known); only a lookup that SUCCEEDS and finds no usable owner records the event unattributed (the platform report lists it). A write that fails is thrown too; a notice that fails never is.
export type PaymentEventKind = "payment_failed" | "refund" | "dispute_opened" | "dispute_closed";

export interface PaymentEventInput {
  eventId: string;
  kind: PaymentEventKind;
  groupId: string | null;
  athleteId: string | null;
  coachId: string | null;
  // This event's own amount (for a refund: this refund, not the running total).
  amountCents: number | null;
  // For a refund: everything refunded on the charge so far.
  totalCents: number | null;
  currency: string | null;
  objectId: string | null;
  subscriptionId: string | null;
  detail: string | null;
}

const money = (cents: number | null, currency: string | null) =>
  cents == null ? "" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: (currency ?? "usd").toUpperCase() });

// What the coach reads in the bell. The text has the name and the amount; the lock screen does not (a client's name and an amount are not for anyone who glances at the phone).
export function problemText(kind: PaymentEventKind, name: string, amountCents: number | null, currency: string | null, detail: string | null, totalCents: number | null = null): string {
  const amount = money(amountCents, currency);
  switch (kind) {
    case "payment_failed":
      return `${name}'s payment${amount ? ` of ${amount}` : ""} didn't go through. Stripe will try again; ask them to update their card if it keeps failing.`;
    case "refund": {
      const total = totalCents != null && amountCents != null && totalCents !== amountCents ? ` (${money(totalCents, currency)} refunded in total)` : "";
      return `${name} was refunded${amount ? ` ${amount}` : ""} in Stripe${total}. Their sessions were not changed here.`;
    }
    case "dispute_opened":
      return `${name} disputed a payment${amount ? ` of ${amount}` : ""} with their bank. Answer it in your Stripe dashboard.`;
    case "dispute_closed":
      return `The dispute${amount ? ` over ${amount}` : ""} from ${name} was closed${detail ? `: ${detail}` : ""}.`;
  }
}

export const LOCK_SCREEN_TEXT = "Open the app to see it.";
const TITLE: Record<PaymentEventKind, string> = { payment_failed: "A payment failed", refund: "A refund was made", dispute_opened: "A payment was disputed", dispute_closed: "A dispute was closed" };

// Records the event once. Returns true when this call recorded it, false when it was already recorded.
export async function recordPaymentEvent(db: any, e: PaymentEventInput): Promise<boolean> {
  const { error } = await db.from("payment_events").insert({
    stripe_event_id: e.eventId,
    kind: e.kind,
    group_id: e.groupId,
    athlete_id: e.athleteId,
    coach_id: e.coachId,
    amount_cents: e.amountCents,
    total_cents: e.totalCents,
    currency: e.currency,
    stripe_object_id: e.objectId,
    subscription_id: e.subscriptionId,
    detail: e.detail,
  });
  if (error) {
    if (error.code === "23505") return false;
    throw error;
  }
  return true;
}

// Tells the coach seat(s) of the group (or the one coach whose own plan it is). Best effort.
export async function notifyPaymentProblem(db: any, e: PaymentEventInput): Promise<number> {
  try {
    let coachIds: string[] = [];
    if (e.groupId) {
      const { data: seats } = await db.from("group_memberships").select("profile_id").eq("group_id", e.groupId).eq("role", "coach");
      coachIds = [...new Set(((seats ?? []) as { profile_id: string }[]).map((s) => s.profile_id).filter((id) => id !== e.athleteId))];
    } else if (e.coachId) {
      coachIds = [e.coachId];
    }
    if (coachIds.length === 0) return 0;
    let name = "A client";
    if (e.athleteId) {
      const { data: athlete } = await db.from("profiles").select("full_name").eq("id", e.athleteId).maybeSingle();
      name = (athlete as { full_name?: string } | null)?.full_name ?? name;
    }
    const body = e.coachId && !e.groupId ? ownPlanText(e) : problemText(e.kind, name, e.amountCents, e.currency, e.detail, e.totalCents);
    const link = e.groupId ? `/groups/${e.groupId}/business` : "/dashboard";
    for (const coachId of coachIds) {
      const { error } = await db.from("notifications").insert({ profile_id: coachId, group_id: e.groupId, type: "payment_problem", body, link_path: link, pushed_at: new Date().toISOString() });
      if (error) console.error("[payment problem notice] the notification was refused:", error.message);
      await sendPushToProfile(db, coachId, TITLE[e.kind], LOCK_SCREEN_TEXT, link).catch(() => 0);
    }
    return coachIds.length;
  } catch (err) {
    console.error("[payment problem notice] failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

function ownPlanText(e: PaymentEventInput): string {
  const amount = money(e.amountCents, e.currency);
  if (e.kind === "payment_failed") return `Your payment${amount ? ` of ${amount}` : ""} for your plan didn't go through. Update your card in billing so it isn't interrupted.`;
  if (e.kind === "refund") return `Your payment${amount ? ` of ${amount}` : ""} was refunded in Stripe.`;
  return `A payment on your account was disputed. Answer it in your Stripe dashboard.`;
}

interface Who {
  groupId: string | null;
  athleteId: string | null;
  coachId: string | null;
}
const nobody: Who = { groupId: null, athleteId: null, coachId: null };
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const idOf = (ref: unknown): string | null => (typeof ref === "string" ? ref : ref && typeof ref === "object" && typeof (ref as { id?: unknown }).id === "string" ? (ref as { id: string }).id : null);

// Who a Stripe object belongs to, from the metadata the checkout wrote on it. Anything that cannot be worked out comes back empty.
export function whoFromMetadata(meta: Record<string, string> | null | undefined): Who {
  const m = meta ?? {};
  return { groupId: text(m.group_id), athleteId: text(m.athlete_id) ?? text(m.client_id), coachId: text(m.coach_id) };
}

// Stripe says the thing is not there (a deleted subscription or invoice): the lookup SUCCEEDED and found nothing, so the event is recorded unattributed. Any other failure is thrown.
function isMissing(err: unknown): boolean {
  const e = err as { code?: string; statusCode?: number } | null;
  return !!e && (e.code === "resource_missing" || e.statusCode === 404);
}

async function whoFromSubscription(stripe: Stripe, subscriptionId: string | null): Promise<Who> {
  if (!subscriptionId) return nobody;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    return whoFromMetadata(sub.metadata as Record<string, string>);
  } catch (err) {
    if (isMissing(err)) return nobody;
    throw err;
  }
}

// The subscription an invoice belongs to, in either shape Stripe sends: parent.subscription_details.subscription (newer API versions) or subscription (older).
export function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  const newer = (invoice as unknown as { parent?: { subscription_details?: { subscription?: unknown } } }).parent?.subscription_details?.subscription;
  return idOf(newer) ?? idOf((invoice as unknown as { subscription?: unknown }).subscription);
}

// The invoice a charge paid, in either shape: charge.invoice (older API versions) or, where the charge no longer carries it, the invoice payment recorded for its payment intent (newer ones).
export async function invoiceIdOfCharge(stripe: Stripe, charge: Stripe.Charge): Promise<string | null> {
  const direct = idOf((charge as unknown as { invoice?: unknown }).invoice);
  if (direct) return direct;
  const paymentIntentId = idOf((charge as unknown as { payment_intent?: unknown }).payment_intent);
  if (!paymentIntentId) return null;
  try {
    const payments = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: paymentIntentId }, limit: 1 });
    return idOf(payments.data[0]?.invoice);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

// A charge's owner: first the checkout that made it (a pack, a quick payment), else the subscription whose invoice it paid (a renewal has no checkout session).
export async function whoFromCharge(stripe: Stripe, charge: Stripe.Charge): Promise<Who> {
  const paymentIntentId = idOf((charge as unknown as { payment_intent?: unknown }).payment_intent);
  if (paymentIntentId) {
    const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
    const found = whoFromMetadata(sessions.data[0]?.metadata as Record<string, string> | undefined);
    if (found.groupId || found.athleteId || found.coachId) return found;
  }
  const invoiceId = await invoiceIdOfCharge(stripe, charge);
  if (!invoiceId) return nobody;
  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    return await whoFromSubscription(stripe, subscriptionIdOfInvoice(invoice));
  } catch (err) {
    if (isMissing(err)) return nobody;
    throw err;
  }
}

// The one entry point the webhook calls for these four kinds of event.
export async function handlePaymentProblemEvent(event: Stripe.Event, deps: { db: any; stripe: Stripe }): Promise<void> {
  const { db, stripe } = deps;
  let input: PaymentEventInput | null = null;
  // Only the first failed attempt of an invoice tells the coach (Stripe retries, and each retry is another event: those are recorded, not announced again).
  let announce = true;

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = subscriptionIdOfInvoice(invoice);
    const who = await whoFromSubscription(stripe, subscriptionId);
    const attempt = (invoice as unknown as { attempt_count?: number }).attempt_count;
    input = {
      eventId: event.id,
      kind: "payment_failed",
      ...who,
      amountCents: invoice.amount_due ?? null,
      totalCents: null,
      currency: invoice.currency ?? null,
      objectId: invoice.id ?? null,
      subscriptionId,
      detail: typeof attempt === "number" ? `attempt ${attempt}` : null,
    };
    if (invoice.id) {
      const { count } = await db.from("payment_events").select("id", { count: "exact", head: true }).eq("kind", "payment_failed").eq("stripe_object_id", invoice.id);
      announce = (count ?? 0) === 0;
    }
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const who = await whoFromCharge(stripe, charge);
    const total = charge.amount_refunded ?? null;
    // This refund is what the charge now shows refunded minus what was already recorded for it.
    let thisRefund = total;
    if (total != null) {
      const { data: earlier, error } = await db.from("payment_events").select("amount_cents").eq("kind", "refund").eq("stripe_object_id", charge.id);
      if (error) throw error;
      const before = ((earlier ?? []) as { amount_cents: number | null }[]).reduce((n, r) => n + (r.amount_cents ?? 0), 0);
      thisRefund = Math.max(0, total - before);
    }
    input = { eventId: event.id, kind: "refund", ...who, amountCents: thisRefund, totalCents: total, currency: charge.currency ?? null, objectId: charge.id, subscriptionId: null, detail: null };
  } else if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
    const dispute = event.data.object as Stripe.Dispute;
    const chargeId = idOf(dispute.charge);
    const who = chargeId ? await whoFromCharge(stripe, await stripe.charges.retrieve(chargeId)) : nobody;
    const closed = event.type === "charge.dispute.closed";
    input = {
      eventId: event.id,
      kind: closed ? "dispute_closed" : "dispute_opened",
      ...who,
      amountCents: dispute.amount ?? null,
      totalCents: null,
      currency: dispute.currency ?? null,
      objectId: dispute.id,
      subscriptionId: null,
      detail: closed ? (dispute.status === "won" ? "you won" : dispute.status === "lost" ? "you lost" : dispute.status ?? null) : null,
    };
  }
  if (!input) return;

  // Recorded once; the notice goes only the first time the event is handled.
  const first = await recordPaymentEvent(db, input);
  if (first && announce) await notifyPaymentProblem(db, input);
}

export const PAYMENT_PROBLEM_EVENT_TYPES = ["invoice.payment_failed", "charge.refunded", "charge.dispute.created", "charge.dispute.closed"] as const;
