import type { SupabaseClient } from "@supabase/supabase-js";
import { packFor } from "@/lib/ai-budget";
import { monthStartDate } from "@/lib/ai-budget-server";

// Records one paid AI top-up from the payment webhook. The dollars added come from OUR pack table, found by the price of the pack BEFORE tax and discounts (amount_subtotal, in US
// dollars), and only when the pack the checkout was created for (metadata.pack_cents) says the same: a tax line or a promotion code must never make a paid top-up credit nothing,
// and neither value is trusted alone. A payment that cannot be matched adds nothing but is logged loudly with the event id, so a paid-but-uncredited top-up is visible and can be
// credited by hand. The event id is unique in ai_budget_topups, so Stripe sending the same event twice adds the money once.
export type AiTopUpResult = "added" | "duplicate" | "ignored";

export interface AiTopUpInput {
  eventId: string;
  sessionId?: string;
  organizationId: string | null | undefined;
  // Price of the pack before tax and discounts (the checkout session's amount_subtotal) and its currency.
  subtotalCents: number | null | undefined;
  currency: string | null | undefined;
  // The pack the checkout was created for, from the session metadata.
  metadataPackCents: string | number | null | undefined;
  eventCreatedSeconds?: number;
}

function logUnmatched(input: AiTopUpInput, why: string): void {
  console.error(
    `[ai-topup] PAID TOP-UP NOT CREDITED (${why}): event ${input.eventId}, checkout session ${input.sessionId ?? "unknown"}, organization ${input.organizationId ?? "none"}, subtotal ${input.subtotalCents ?? "none"} ${input.currency ?? ""}, pack in metadata ${input.metadataPackCents ?? "none"}. Credit it by hand if the payment was real.`
  );
}

export async function recordAiTopUp(db: SupabaseClient, input: AiTopUpInput): Promise<AiTopUpResult> {
  const { eventId, organizationId } = input;
  if (!organizationId) {
    logUnmatched(input, "no organization on the payment");
    return "ignored";
  }
  if ((input.currency ?? "").toLowerCase() !== "usd") {
    logUnmatched(input, "currency is not usd");
    return "ignored";
  }
  const pack = packFor(Number(input.subtotalCents ?? 0));
  if (!pack) {
    logUnmatched(input, "the price before tax matches no pack");
    return "ignored";
  }
  if (Number(input.metadataPackCents) !== pack.cents) {
    logUnmatched(input, "the pack on the checkout does not match the price paid");
    return "ignored";
  }
  const at = input.eventCreatedSeconds ? new Date(input.eventCreatedSeconds * 1000) : new Date();
  const { error } = await db.from("ai_budget_topups").insert({
    organization_id: organizationId,
    month: monthStartDate(at),
    usd_added: pack.addUsd,
    pack_cents: pack.cents,
    stripe_event_id: eventId,
  });
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw error;
  }
  return "added";
}
