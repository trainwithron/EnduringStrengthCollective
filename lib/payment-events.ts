import type Stripe from "stripe";
import { sendPushToProfile } from "@/lib/send-push";

// Money events that used to leave no trace in the app (Release M1): a client's failed payment, a refund made in Stripe, a dispute (chargeback) opened and closed. Each is RECORDED (payment_events, one row per Stripe event) and the
// coach who owns the money is told. Nothing else happens: no balance changes, no sessions are taken back, no access ends and no money moves. A refund does not take sessions off the client and a failed payment does not
// end their access; whether either should is the coach's call (and Ron's), listed in docs/NEEDS_RON.md.
// A redelivered event is a harmless duplicate (stripe_event_id is unique). Who the money belongs to is looked up in Stripe BEFORE anything is written. A lookup that FAILS is thrown so Stripe sends the event again (nothing
// is recorded half-known) ONLY while the event is recent (under a day old) and the failure could be passing; an older event, or a failure that retrying cannot fix (the key may not read that object: 401/403), is recorded
// unattributed with a note and logged, never answered with an error (Stripe redelivers a failing event for days and can switch a failing endpoint off, which would stop checkout and subscription events too).
// A lookup that SUCCEEDS and finds no usable owner records the event unattributed too (the platform report lists it). A write that fails is thrown; a notice that fails never is.
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
  // For a refund: Stripe's own id of THIS refund (one row per refund).
  refundId?: string | null;
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

export interface Recorded {
  id: string | null;
  // This call recorded it (false: it was already there).
  first: boolean;
  // The coach has already been told about it.
  notified: boolean;
  // What was actually stored (the owner is dropped when it no longer exists).
  stored: PaymentEventInput;
}

// Records the event once (one row per Stripe event, and one per Stripe refund). A repeat finds the row that is already there and says whether the coach was told.
// A Stripe event can name a group or account that has since been erased (a refund or dispute arrives months after the payment): the insert is refused as 'owner not valid' (a missing row, a malformed id, a failed check). That is
// not a passing fault, so retrying the webhook would never help: the event is stored once more with no owner and a note, and logged. Anything else wrong with the database is thrown (Stripe sends the event again).
const OWNER_NOT_VALID = new Set(["23503", "22P02", "23514"]);

export async function recordPaymentEvent(db: any, input: PaymentEventInput): Promise<Recorded> {
  let e = input;
  let result = await insertEvent(db, e);
  if (result.error && OWNER_NOT_VALID.has(result.error.code ?? "") && (e.groupId || e.athleteId || e.coachId)) {
    console.error("[payment events] the owner no longer exists, recording the event without one:", e.eventId, result.error.code);
    e = { ...e, groupId: null, athleteId: null, coachId: null, detail: [e.detail, "owner no longer exists"].filter(Boolean).join("; ") };
    result = await insertEvent(db, e);
  }
  const { data, error } = result;
  if (!error) return { id: (data as { id: string } | null)?.id ?? null, first: true, notified: false, stored: e };
  if (error.code !== "23505") throw error;
  // Already recorded: by this event, or (a refund) by another event that carried the same refund.
  let existing = await db.from("payment_events").select("id, notified_at").eq("stripe_event_id", e.eventId).maybeSingle();
  if (!existing.error && !existing.data && e.refundId) existing = await db.from("payment_events").select("id, notified_at").eq("refund_id", e.refundId).maybeSingle();
  if (existing.error) throw existing.error;
  const row = existing.data as { id: string; notified_at: string | null } | null;
  return { id: row?.id ?? null, first: false, notified: !!row?.notified_at, stored: e };
}

async function insertEvent(db: any, e: PaymentEventInput): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> {
  return db
    .from("payment_events")
    .insert({
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
      refund_id: e.refundId ?? null,
      detail: e.detail,
    })
    .select("id")
    .single();
}

// Remembers that the coach was told, so a redelivery that finds the row but no memory of a notice still tells them once.
async function markNotified(db: any, id: string | null): Promise<void> {
  if (!id) return;
  const { error } = await db.from("payment_events").update({ notified_at: new Date().toISOString() }).eq("id", id);
  if (error) console.error("[payment events] could not mark the notice as sent:", error.message);
}

// Tells the coach seat(s) of the group (or the one coach whose own plan it is). Best effort. Returns how many notices were actually written (0 when there is no coach seat, or the notice was refused).
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
    let delivered = 0;
    for (const coachId of coachIds) {
      const { error } = await db.from("notifications").insert({ profile_id: coachId, group_id: e.groupId, type: "payment_problem", body, link_path: link, pushed_at: new Date().toISOString() });
      if (error) {
        console.error("[payment problem notice] the notification was refused:", error.message);
        continue;
      }
      delivered++;
      await sendPushToProfile(db, coachId, TITLE[e.kind], LOCK_SCREEN_TEXT, link).catch(() => 0);
    }
    return delivered;
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

export const RETRY_WINDOW_SECONDS = 24 * 3600;
const UNATTRIBUTED_NOTE = "owner could not be looked up";

// Runs a lookup. A failure is thrown (so Stripe retries) only for a recent event and only when retrying could help; otherwise the answer is "nobody", with a note for the record.
async function attribute<T>(event: Stripe.Event, look: () => Promise<T>, fallback: T, now: number = Date.now() / 1000): Promise<{ value: T; note: string | null }> {
  try {
    return { value: await look(), note: null };
  } catch (err) {
    const e = err as { statusCode?: number; type?: string; message?: string } | null;
    const cannotBeFixedByRetrying = e?.statusCode === 401 || e?.statusCode === 403 || e?.type === "StripePermissionError" || e?.type === "StripeAuthenticationError";
    const recent = now - (event.created ?? 0) < RETRY_WINDOW_SECONDS;
    if (recent && !cannotBeFixedByRetrying) throw err;
    console.error("[payment events] recording the event unattributed, the owner could not be looked up:", event.id, e?.message ?? err);
    return { value: fallback, note: UNATTRIBUTED_NOTE };
  }
}

const joinNote = (a: string | null, b: string | null) => [a, b].filter(Boolean).join("; ") || null;

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
  const inputs: PaymentEventInput[] = [];
  // Only the first failed attempt of an invoice tells the coach (Stripe retries, and each retry is another event: those are recorded, not announced again).
  let announce = true;

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = subscriptionIdOfInvoice(invoice);
    const { value: who, note } = await attribute(event, () => whoFromSubscription(stripe, subscriptionId), nobody);
    const attempt = (invoice as unknown as { attempt_count?: number }).attempt_count;
    inputs.push({
      eventId: event.id,
      kind: "payment_failed",
      ...who,
      amountCents: invoice.amount_due ?? null,
      totalCents: null,
      currency: invoice.currency ?? null,
      objectId: invoice.id ?? null,
      subscriptionId,
      detail: joinNote(typeof attempt === "number" ? `attempt ${attempt}` : null, note),
    });
    if (invoice.id) {
      // Told once per invoice: if an earlier attempt's notice already went out, this one is recorded only. A read that fails is thrown (never guessed as "nobody told yet").
      const { data: earlier, error } = await db.from("payment_events").select("id, notified_at").eq("kind", "payment_failed").eq("stripe_object_id", invoice.id);
      if (error) throw error;
      announce = !((earlier ?? []) as { notified_at: string | null }[]).some((r) => !!r.notified_at);
    }
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const owner = await attribute(event, () => whoFromCharge(stripe, charge), nobody);
    // Stripe's own list of this charge's refunds: one row per refund id, each with that refund's own amount, so refunds that arrive out of order or at the same moment are each right.
    const listed = await attribute<Stripe.Refund[] | null>(event, async () => (await stripe.refunds.list({ charge: charge.id, limit: 100 })).data, null);
    const total = charge.amount_refunded ?? null;
    const note = joinNote(owner.note, listed.note);
    const base = { kind: "refund" as const, ...owner.value, totalCents: total, currency: charge.currency ?? null, objectId: charge.id, subscriptionId: null };
    const real = (listed.value ?? []).filter((r) => r.status !== "failed" && r.status !== "canceled");
    if (real.length > 0) {
      for (const r of real) inputs.push({ ...base, eventId: `${event.id}:${r.id}`, amountCents: r.amount, refundId: r.id, detail: note });
    } else {
      inputs.push({ ...base, eventId: event.id, amountCents: total, detail: note });
    }
  } else if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
    const dispute = event.data.object as Stripe.Dispute;
    const chargeId = idOf(dispute.charge);
    const owner = await attribute(
      event,
      async () => {
        if (!chargeId) return nobody;
        try {
          return await whoFromCharge(stripe, await stripe.charges.retrieve(chargeId));
        } catch (err) {
          // A charge Stripe says is not there (another account or mode, or deleted) will never be found: unattributed, not retried for days.
          if (isMissing(err)) return nobody;
          throw err;
        }
      },
      nobody
    );
    const closed = event.type === "charge.dispute.closed";
    inputs.push({
      eventId: event.id,
      kind: closed ? "dispute_closed" : "dispute_opened",
      ...owner.value,
      amountCents: dispute.amount ?? null,
      totalCents: null,
      currency: dispute.currency ?? null,
      objectId: dispute.id,
      subscriptionId: null,
      detail: joinNote(closed ? (dispute.status === "won" ? "you won" : dispute.status === "lost" ? "you lost" : dispute.status ?? null) : null, owner.note),
    });
  }

  let upgradedFallback = false;
  for (const input of inputs) {
    let recorded: Recorded | null = null;
    // A refund first recorded through the fallback row (the list of refunds could not be read, so it holds the charge total) becomes the first real refund when the event is delivered again and the list works: one row, one notice.
    if (input.kind === "refund" && input.refundId && !upgradedFallback) {
      const { data: fallback, error: fallbackError } = await db.from("payment_events").select("id, notified_at").eq("stripe_event_id", event.id).eq("kind", "refund").is("refund_id", null).maybeSingle();
      if (fallbackError) throw fallbackError;
      const row = fallback as { id: string; notified_at: string | null } | null;
      if (row) {
        upgradedFallback = true;
        const { error: upgradeError } = await db.from("payment_events").update({ refund_id: input.refundId, amount_cents: input.amountCents, total_cents: input.totalCents, detail: input.detail }).eq("id", row.id);
        if (upgradeError && upgradeError.code !== "23505") throw upgradeError;
        if (upgradeError) {
          // That refund already has its own row (another event recorded it): the fallback row is redundant and would count it twice, so it goes.
          const { error: dropError } = await db.from("payment_events").delete().eq("id", row.id);
          if (dropError) throw dropError;
        } else {
          recorded = { id: row.id, first: false, notified: !!row.notified_at, stored: input };
        }
      }
    }
    if (!recorded) recorded = await recordPaymentEvent(db, input);
    // The coach is told the first time, and also on a redelivery of an event whose notice never went out. The mark is only made when a notice was really written (no coach seat, or a refused notice, leaves it open for a later delivery).
    if (announce && (recorded.first || !recorded.notified)) {
      const delivered = await notifyPaymentProblem(db, recorded.stored);
      if (delivered > 0) await markNotified(db, recorded.id);
    }
  }
}

export const PAYMENT_PROBLEM_EVENT_TYPES = ["invoice.payment_failed", "charge.refunded", "charge.dispute.created", "charge.dispute.closed"] as const;
