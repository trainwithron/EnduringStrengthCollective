import type { BudgetLevel } from "@/lib/ai-budget";

// DESIGN HOOK, not wired to anything that charges. Whether a client may use AI food logging (photo and typed estimates) is decided here in one place, so a per-client
// add-on (Ron floated about $5 per client per month) can be added later without touching the AI routes: when a client has the add-on, their AI logging is theirs to use even
// after the coach's monthly AI budget is used up. Billing is off today, so `clientAddOn` is never true and nothing is charged. When billing is live, the add-on purchase
// sets it; the budget gate (lib/ai-usage-server.ts) then asks this function before refusing a client's AI logging.
//
// Free ways to log (food search, barcode, saved meals, copy yesterday) never ask this: they are always allowed unless the coach turned tracking off.

export type AiLoggingReason = "ok" | "tracking_off" | "budget_out" | "add_on";

export interface AiLoggingEntitlementInput {
  // The coach's per-client switch (group_memberships.food_tracking_enabled).
  trackingEnabled: boolean;
  // Where the coach's monthly AI budget stands.
  budgetLevel: BudgetLevel;
  // A future per-client AI-logging add-on. Always false while billing is off.
  clientAddOn?: boolean;
}

export function aiLoggingEntitlement(input: AiLoggingEntitlementInput): { allowed: boolean; reason: AiLoggingReason } {
  if (!input.trackingEnabled) return { allowed: false, reason: "tracking_off" };
  if (input.budgetLevel === "out") {
    return input.clientAddOn ? { allowed: true, reason: "add_on" } : { allowed: false, reason: "budget_out" };
  }
  return { allowed: true, reason: "ok" };
}
