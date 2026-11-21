// A client's card payment that failed ($5, Ron Nov 20): the words the client and the coach see, worked out from what the app already records.
// What the app knows: the subscription's own status from Stripe (membership_subscriptions.status: past_due while Stripe is still trying the card, lib/subscription-status.ts),
// and each failed try (payment_events, written by the Stripe webhook, lib/payment-events.ts) with the date Stripe says it will try again (next_attempt_at, migration 0464;
// empty when Stripe will not try again or the row is older). Nothing here blocks, pauses or charges anyone: Ron's rule for clients who fall behind is still being decided.
import { formatInTimezone } from "@/lib/format-in-timezone";

export interface FailedPaymentInput {
  status: string | null | undefined;
  // the newest failed try recorded for that subscription, if any
  latest?: { created_at: string; next_attempt_at?: string | null } | null;
}

export interface FailedPayment {
  failedAt: string | null;
  nextTryAt: string | null;
}

// Shown only while Stripe says the subscription is past due (a failed renewal it is still trying). A next try in the past is not shown as a date.
export function failedPayment(input: FailedPaymentInput, now: Date = new Date()): FailedPayment | null {
  if (input.status !== "past_due") return null;
  const next = input.latest?.next_attempt_at ?? null;
  const nextTryAt = next && !Number.isNaN(Date.parse(next)) && Date.parse(next) > now.getTime() ? next : null;
  return { failedAt: input.latest?.created_at ?? null, nextTryAt };
}

export function clientFailedPaymentLine(f: FailedPayment, timeZone: string | null | undefined): string {
  const when = f.nextTryAt ? ` before Stripe tries it again on ${formatInTimezone(f.nextTryAt, timeZone, "date")}` : "";
  return `Your last card payment didn't go through. Please update your card${when}. Nothing else changes while it's sorted out.`;
}

// What Stripe does next, for the coach. Only what the record says: the date of the next try when Stripe gave one; otherwise the retry schedule is the one set in the coach's
// own Stripe account, and so is what happens after the last try.
export function coachFailedPaymentLine(f: FailedPayment, timeZone: string | null | undefined): string {
  const failed = f.failedAt ? ` on ${formatInTimezone(f.failedAt, timeZone, "date")}` : "";
  const next = f.nextTryAt
    ? `Stripe will try the card again on ${formatInTimezone(f.nextTryAt, timeZone, "date")}.`
    : "Stripe tries the card again on the retry schedule in your Stripe settings.";
  return `Their card payment failed${failed}. ${next} What happens after the last try is set in your Stripe settings too. Nothing changes here on its own: their sessions and access stay as they are. They see a note asking them to update their card.`;
}

// Reads it for one client in one space, under the viewer's own sign-in (the client reads their own rows; a coach of the space reads the space's). Any read that fails shows
// nothing rather than a wrong line. Before migration 0464 there is no next-try column, and the read is made again without it.
export async function loadFailedPayment(supabase: any, args: { athleteId: string; groupId: string }, now: Date = new Date()): Promise<FailedPayment | null> {
  const { data: sub, error } = await supabase.from("membership_subscriptions").select("status, stripe_subscription_id").eq("athlete_id", args.athleteId).eq("group_id", args.groupId).maybeSingle();
  if (error || !sub || sub.status !== "past_due") return null;
  const latestFor = (columns: string) =>
    supabase.from("payment_events").select(columns).eq("kind", "payment_failed").eq("athlete_id", args.athleteId).eq("subscription_id", sub.stripe_subscription_id).order("created_at", { ascending: false }).limit(1);
  let events = await latestFor("created_at, next_attempt_at");
  if (events.error) events = await latestFor("created_at");
  const latest = !events.error && Array.isArray(events.data) && events.data[0] ? (events.data[0] as { created_at: string; next_attempt_at?: string | null }) : null;
  return failedPayment({ status: sub.status, latest }, now);
}
