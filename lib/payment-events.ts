import type Stripe from "stripe";
import { sendPushToProfile } from "@/lib/send-push";

// Money events that used to leave no trace in the app (Release M1): a client's failed payment, a refund made in Stripe, a dispute (chargeback) opened and closed. Each is RECORDED (payment_events, one row per Stripe event) and the
// coach who owns the money is told. Nothing else happens: no balance changes, no sessions are taken back, no access ends and no money moves. A refund does not take sessions off the client and a failed payment does not
// end their access; whether either should is the coach's call (and Ron's), listed in docs/NEEDS_RON.md.
// A redelivered event is a harmless duplicate (stripe_event_id is unique). A write that fails is thrown so Stripe sends the event again; a notice that fails never is (the record is what matters).
export type PaymentEventKind = "payment_failed" | "refund" | "dispute_opened" | "dispute_closed";

export interface PaymentEventInput {
  eventId: string;
  kind: PaymentEventKind;
  groupId: string | null;
  athleteId: string | null;
  coachId: string | null;
  amountCents: number | null;
  currency: string | null;
  objectId: string | null;
  detail: string | null;
}

const money = (cents: number | null, currency: string | null) =>
  cents == null ? "" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: (currency ?? "usd").toUpperCase() });

// What the coach reads in the bell. The text has the name and the amount; the lock screen does not (a client's name and an amount are not for anyone who glances at the phone).
export function problemText(kind: PaymentEventKind, name: string, amountCents: number | null, currency: string | null, detail: string | null): string {
  const amount = money(amountCents, currency);
  switch (kind) {
    case "payment_failed":
      return `${name}'s payment${amount ? ` of ${amount}` : ""} didn't go through. Stripe will try again; ask them to update their card if it keeps failing.`;
    case "refund":
      return `${name} was refunded${amount ? ` ${amount}` : ""} in Stripe. Their sessions were not changed here.`;
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
    currency: e.currency,
    stripe_object_id: e.objectId,
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
    } else if (e.coachId && !e.groupId) {
      name = "Your";
    }
    const body = e.coachId && !e.groupId ? ownPlanText(e) : problemText(e.kind, name, e.amountCents, e.currency, e.detail);
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

// Who a Stripe object belongs to, from the metadata the checkout wrote on it. Anything that cannot be worked out comes back empty (the record is still kept, flagged "not attributed" in the platform report).
export function whoFromMetadata(meta: Record<string, string> | null | undefined): Who {
  const m = meta ?? {};
  return { groupId: text(m.group_id), athleteId: text(m.athlete_id) ?? text(m.client_id), coachId: text(m.coach_id) };
}

async function whoFromSubscription(stripe: Stripe, subscriptionId: string | null): Promise<Who> {
  if (!subscriptionId) return nobody;
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return whoFromMetadata(sub.metadata as Record<string, string>);
}

function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  const ref = invoice.parent?.subscription_details?.subscription;
  return typeof ref === "string" ? ref : ref?.id ?? null;
}

// A charge's owner: first the checkout that made it (a pack, a quick payment), else the invoice of the subscription it paid.
export async function whoFromCharge(stripe: Stripe, charge: Stripe.Charge): Promise<Who> {
  try {
    const piRef = (charge as unknown as { payment_intent?: string | { id: string } | null }).payment_intent;
    const paymentIntentId = typeof piRef === "string" ? piRef : piRef?.id ?? null;
    if (paymentIntentId) {
      const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
      const found = whoFromMetadata(sessions.data[0]?.metadata as Record<string, string> | undefined);
      if (found.groupId || found.athleteId || found.coachId) return found;
    }
    const invoiceRef = (charge as unknown as { invoice?: string | { id: string } | null }).invoice;
    const invoiceId = typeof invoiceRef === "string" ? invoiceRef : invoiceRef?.id ?? null;
    if (invoiceId) {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      return await whoFromSubscription(stripe, subscriptionIdOfInvoice(invoice));
    }
  } catch (err) {
    console.error("[payment events] could not work out whose charge this is:", err instanceof Error ? err.message : err);
  }
  return nobody;
}

// The one entry point the webhook calls for these four kinds of event.
export async function handlePaymentProblemEvent(event: Stripe.Event, deps: { db: any; stripe: Stripe }): Promise<void> {
  const { db, stripe } = deps;
  let input: PaymentEventInput | null = null;

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    let who = nobody;
    try {
      who = await whoFromSubscription(stripe, subscriptionIdOfInvoice(invoice));
    } catch (err) {
      console.error("[payment events] could not read the subscription:", err instanceof Error ? err.message : err);
    }
    input = { eventId: event.id, kind: "payment_failed", ...who, amountCents: invoice.amount_due ?? null, currency: invoice.currency ?? null, objectId: invoice.id ?? null, detail: null };
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const who = await whoFromCharge(stripe, charge);
    input = { eventId: event.id, kind: "refund", ...who, amountCents: charge.amount_refunded ?? null, currency: charge.currency ?? null, objectId: charge.id, detail: null };
  } else if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
    const dispute = event.data.object as Stripe.Dispute;
    let who = nobody;
    try {
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      if (chargeId) who = await whoFromCharge(stripe, await stripe.charges.retrieve(chargeId));
    } catch (err) {
      console.error("[payment events] could not read the disputed charge:", err instanceof Error ? err.message : err);
    }
    const closed = event.type === "charge.dispute.closed";
    input = {
      eventId: event.id,
      kind: closed ? "dispute_closed" : "dispute_opened",
      ...who,
      amountCents: dispute.amount ?? null,
      currency: dispute.currency ?? null,
      objectId: dispute.id,
      detail: closed ? (dispute.status === "won" ? "you won" : dispute.status === "lost" ? "you lost" : dispute.status ?? null) : null,
    };
  }
  if (!input) return;

  // Recorded once; the notice goes only the first time the event is handled.
  const first = await recordPaymentEvent(db, input);
  if (first) await notifyPaymentProblem(db, input);
}

export const PAYMENT_PROBLEM_EVENT_TYPES = ["invoice.payment_failed", "charge.refunded", "charge.dispute.created", "charge.dispute.closed"] as const;
