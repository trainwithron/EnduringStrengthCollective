// Coach subscription pricing (settled 2026-10-05). The plan is billed per
// ORGANIZATION. Every number a person might want to tune lives in this one
// file; the Stripe prices (phase 2) are created to match it.
//
//   $50/mo base, includes the first coach and up to 100 clients
//   +$25/mo for each additional block of 100 clients
//   +$15/mo for each coach beyond the first
//   +$50/mo Organization add-on (kiosk check-in, session ledger, revenue
//    splits, org branding, multi-trainer oversight)
//   Above 400 clients the price is negotiated: the bill stays at the
//   400-client tier and the org is flagged.

import { CLIENT_STEP_SIZE, clientSteps } from "@/lib/ai-usage";

// The ONE trial-length constant (settled with Ron: 6 weeks). A
// missing organization_billing row means "trial from the org's
// created_at", so changing this changes every unsettled trial at once.
export const TRIAL_DAYS = 42; // 6 weeks, no card required (Ron, 2026-10-05)

// After a trial or a failed payment runs out, coaches get this many days
// of banner-only warnings before the coach side locks.
export const GRACE_DAYS = 7;

export const PLAN_PRICES_CENTS = {
  base: 5000,
  clientBlock: 2500,
  coachSeat: 1500,
  orgAddon: 5000,
} as const;

// Steps of CLIENT_STEP_SIZE clients priced automatically. Step 1 is the
// base; steps 2..4 each add one client block (so 400 clients max).
export const MAX_AUTO_CLIENT_STEPS = 4;
export const MAX_AUTO_CLIENTS = MAX_AUTO_CLIENT_STEPS * CLIENT_STEP_SIZE;

export type PlanLineKey = "base" | "clientBlock" | "coachSeat" | "orgAddon";

export interface PlanLine {
  key: PlanLineKey;
  label: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export interface PlanQuote {
  clients: number;
  // Steps implied by the real client count (uncapped) and the steps
  // actually billed (capped at MAX_AUTO_CLIENT_STEPS).
  steps: number;
  billedSteps: number;
  overCap: boolean;
  seats: number;
  extraSeats: number;
  orgAddon: boolean;
  lines: PlanLine[];
  totalCents: number;
  // How many more clients fit before the next step kicks in (0 = the very next client does), and what the next step
  // would bring the monthly total to. null at the cap.
  clientsBeforeNextStep: number | null;
  nextStepTotalCents: number | null;
}

export function computePlanQuote(input: {
  clients: number;
  coachSeats: number;
  orgAddon: boolean;
}): PlanQuote {
  const clients = Math.max(0, Math.floor(input.clients));
  const seats = Math.max(1, Math.floor(input.coachSeats));
  const steps = clientSteps(clients);
  const billedSteps = Math.min(steps, MAX_AUTO_CLIENT_STEPS);
  const extraSteps = billedSteps - 1;
  const extraSeats = seats - 1;

  const lines: PlanLine[] = [
    { key: "base", label: "Base plan (1 coach, up to 100 clients)", quantity: 1, unitCents: PLAN_PRICES_CENTS.base, totalCents: PLAN_PRICES_CENTS.base },
  ];
  if (extraSteps > 0) {
    lines.push({
      key: "clientBlock",
      label: "Additional 100-client blocks",
      quantity: extraSteps,
      unitCents: PLAN_PRICES_CENTS.clientBlock,
      totalCents: extraSteps * PLAN_PRICES_CENTS.clientBlock,
    });
  }
  if (extraSeats > 0) {
    lines.push({
      key: "coachSeat",
      label: "Additional coaches",
      quantity: extraSeats,
      unitCents: PLAN_PRICES_CENTS.coachSeat,
      totalCents: extraSeats * PLAN_PRICES_CENTS.coachSeat,
    });
  }
  if (input.orgAddon) {
    lines.push({
      key: "orgAddon",
      label: "Organization add-on",
      quantity: 1,
      unitCents: PLAN_PRICES_CENTS.orgAddon,
      totalCents: PLAN_PRICES_CENTS.orgAddon,
    });
  }

  const totalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
  const atCap = billedSteps >= MAX_AUTO_CLIENT_STEPS;

  return {
    clients,
    steps,
    billedSteps,
    overCap: steps > MAX_AUTO_CLIENT_STEPS,
    seats,
    extraSeats,
    orgAddon: input.orgAddon,
    lines,
    totalCents,
    clientsBeforeNextStep: atCap ? null : billedSteps * CLIENT_STEP_SIZE - clients,
    nextStepTotalCents: atCap ? null : totalCents + PLAN_PRICES_CENTS.clientBlock,
  };
}

export function formatPlanCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
