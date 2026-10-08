import type { SupabaseClient } from "@supabase/supabase-js";
import { packFor } from "@/lib/ai-budget";
import { monthStartDate } from "@/lib/ai-budget-server";

// Records one paid AI top-up from the payment webhook. The dollars added come from OUR pack table, found by what was actually paid (never from request or metadata
// values), and a payment that matches no pack adds nothing. The event id is unique in ai_budget_topups, so Stripe sending the same event twice adds the money once.
export type AiTopUpResult = "added" | "duplicate" | "ignored";

export async function recordAiTopUp(
  db: SupabaseClient,
  input: { eventId: string; organizationId: string | null | undefined; amountPaidCents: number | null | undefined; eventCreatedSeconds?: number }
): Promise<AiTopUpResult> {
  const { eventId, organizationId, amountPaidCents } = input;
  if (!organizationId) return "ignored";
  const pack = packFor(Number(amountPaidCents ?? 0));
  if (!pack) return "ignored";
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
