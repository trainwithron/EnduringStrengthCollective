import { TRIAL_DAYS, formatPlanCents, MAX_AUTO_CLIENTS } from "@/lib/coach-plan-pricing";
import type { OrgBillingSummary } from "@/lib/org-billing-server";

function formatDate(d: Date | null): string {
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Read-only for now: shows where the organization stands and what the
// plan costs at its current size. No checkout yet (phase 2) — so nothing
// here asks for a card or claims anything is being charged.
export function PlanBillingPanel({
  summary,
  isOwner,
  orgName,
}: {
  summary: OrgBillingSummary;
  isOwner: boolean;
  orgName: string;
}) {
  const { entitlements: e, quote, exemptReason } = summary;

  let statusLine: string;
  let statusDetail: string | null = null;
  switch (e.state) {
    case "exempt":
      statusLine = "Founding account — no charge";
      statusDetail = exemptReason ?? "All features are included.";
      break;
    case "trial":
      statusLine = `Free trial — ${plural(e.trialDaysLeft ?? 0, "day")} left`;
      statusDetail = `Everything is included for the first ${TRIAL_DAYS / 7} weeks, no card needed. Trial ends ${formatDate(e.trialEndsAt)}.`;
      break;
    case "trial_expired":
      statusLine = "Free trial ended";
      statusDetail = `Ended ${formatDate(e.trialEndsAt)}. ${
        e.rawAccessLevel === "grace"
          ? `Everything keeps working for ${plural(e.graceDaysLeft ?? 0, "more day")} while you choose a plan.`
          : "Choose a plan to keep using the coach tools. Your clients can still log workouts."
      }`;
      break;
    case "active":
      statusLine = "Plan active";
      break;
    case "past_due":
      statusLine = "Payment needs attention";
      statusDetail =
        e.rawAccessLevel === "grace"
          ? `Everything keeps working for ${plural(e.graceDaysLeft ?? 0, "more day")}. Update your card to avoid interruption.`
          : "Update your payment method to restore the coach tools. Your clients can still log workouts.";
      break;
    case "canceled":
      statusLine = "Plan canceled";
      statusDetail = "Everything keeps working until the end of the period you paid for.";
      break;
    default:
      statusLine = "Plan inactive";
      statusDetail = "Choose a plan to keep using the coach tools. Your clients can still log workouts.";
  }

  const showQuote = !e.exempt;

  return (
    <div className="max-w-[64ch] space-y-5">
      <div className="border border-steel/20 p-4">
        <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1">{orgName}</p>
        <p className="font-display text-2xl uppercase leading-tight">{statusLine}</p>
        {statusDetail && <p className="font-body text-sm text-steel mt-1">{statusDetail}</p>}
      </div>

      {!e.enforced && (
        <p className="font-body text-xs text-steel border-l-2 border-steel/40 pl-3">
          Billing isn&apos;t switched on yet — nothing is charged and nothing is limited.
          {e.rawAccessLevel !== "full" || (!e.exempt && !e.rawOrgAddon)
            ? " This is what would apply once it is."
            : ""}
        </p>
      )}

      {showQuote && (
        <div className="border border-steel/20 p-4">
          <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-3">
            Your plan at your current size
          </p>
          <div className="space-y-2">
            {quote.lines.map((l) => (
              <div key={l.key} className="flex items-baseline justify-between gap-4">
                <p className="font-body text-sm">
                  {l.label}
                  {l.quantity > 1 && <span className="text-steel"> × {l.quantity}</span>}
                </p>
                <p className="font-body text-sm tabular-nums">{formatPlanCents(l.totalCents)}/mo</p>
              </div>
            ))}
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-steel/20 mt-3 pt-3">
            <p className="font-body text-sm font-medium">Total</p>
            <p className="font-display text-xl tabular-nums">{formatPlanCents(quote.totalCents)}/mo</p>
          </div>
          {!quote.orgAddon && (
            <p className="font-body text-xs text-steel mt-3">
              The Organization add-on ($50/mo) unlocks kiosk check-in, the session ledger, revenue
              splits, organization branding and multi-trainer oversight.
              {e.state === "trial" ? " It's included during your trial." : ""}
            </p>
          )}
        </div>
      )}

      <div className="border border-steel/20 p-4">
        <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-2">Usage</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="font-display text-2xl tabular-nums">{quote.clients}</p>
            <p className="font-body text-xs text-steel">
              {quote.clients === 1 ? "client" : "clients"} in training
            </p>
          </div>
          <div>
            <p className="font-display text-2xl tabular-nums">{quote.seats}</p>
            <p className="font-body text-xs text-steel">{quote.seats === 1 ? "coach" : "coaches"}</p>
          </div>
        </div>
        {quote.overCap ? (
          <p className="font-body text-xs text-rust mt-3">
            You&apos;re past {MAX_AUTO_CLIENTS} clients. Plans this size are set up individually —
            you won&apos;t be charged beyond the {MAX_AUTO_CLIENTS}-client price, and we&apos;ll be in
            touch.
          </p>
        ) : quote.clientsBeforeNextStep !== null && quote.clientsBeforeNextStep <= 10 ? (
          <p className="font-body text-xs text-steel mt-3">
            {quote.clientsBeforeNextStep === 0
              ? `Your next client moves the plan to ${formatPlanCents(quote.nextStepTotalCents ?? 0)}/mo.`
              : `Room for ${plural(quote.clientsBeforeNextStep, "more client")} before the plan moves to ${formatPlanCents(quote.nextStepTotalCents ?? 0)}/mo.`}
          </p>
        ) : null}
        <p className="font-body text-[11px] text-steel mt-3">
          Clients in training count toward the plan. Social-only members and coaches are free.
        </p>
      </div>

      {!isOwner && (
        <p className="font-body text-xs text-steel">Only the organization&apos;s owner manages billing.</p>
      )}
    </div>
  );
}
