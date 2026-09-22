import Link from "next/link";
import type { HeroFlag } from "@/lib/coach-hero-priority";
import type { HeroEmptyState } from "@/lib/dashboard-data";
import { QUIET_TIER_LABEL as TIER_LABEL } from "@/lib/quiet-client-tier";
import { QuietClientNudgeButton } from "@/components/coach/quiet-client-nudge-button";

// AI Assistant Slice 1 (lib/matched-load-trend.ts) — states the verified
// fact (RPE has moved a specific direction at a matched-or-favorable
// load, for N real sessions) and nothing beyond it. Deliberately never
// asserts a diagnosis ("overtraining," "great progress as fact") — the
// governing rule for this whole feature line is verified fact stated
// plainly, inferred judgment left as a question for the coach to ask.
function sentenceFor(flag: HeroFlag): string {
  if (flag.kind === "low_readiness") {
    return `${flag.athleteName} logged low readiness today — worth a lighter session or a check-in.`;
  }
  if (flag.kind === "matched_load_trend") {
    if (flag.direction === "fatigue") {
      return `${flag.athleteName}'s RPE has risen on ${flag.exerciseName} across their last ${flag.sessionCount} sessions at the same or lower weight — worth checking in on recovery.`;
    }
    return `${flag.athleteName}'s RPE has dropped on ${flag.exerciseName} across their last ${flag.sessionCount} sessions at the same or higher weight — a real strength gain worth calling out.`;
  }
  if (flag.kind === "quiet_client") {
    return `${flag.athleteName} ${TIER_LABEL[flag.tier]}.`;
  }
  return `${flag.athleteName} has missed ${flag.missedCount} habit${flag.missedCount === 1 ? "" : "s"} this week.`;
}

// The "Right now" hero — one computed, most-urgent item across the
// coach's whole book of business, written as a real sentence with one
// clear CTA (coach_dashboard_redesign_scoping.md). Falls back to a
// rotating empty state when nothing real is flagged; never a blank "all
// clear" with nothing to look at.
export function DashboardHero({
  flag,
  emptyState,
}: {
  flag: (HeroFlag & { href: string; orgName: string | null }) | null;
  emptyState: HeroEmptyState | null;
}) {
  if (flag) {
    return (
      <div className="border border-rust/40 bg-rust/5 p-5">
        <div className="flex items-center gap-2 mb-2">
          <p className="font-body text-[10px] text-rust uppercase tracking-wide font-bold">Right now</p>
          {flag.orgName && (
            <p className="font-body text-[10px] text-steel uppercase tracking-wide">— {flag.orgName}</p>
          )}
        </div>
        <p className="font-body text-lg text-chalk mb-3">{sentenceFor(flag)}</p>
        <div className="flex items-center gap-4">
          <Link href={flag.href} className="font-body text-sm text-rust font-medium">
            View {flag.athleteName.split(" ")[0]}&apos;s profile →
          </Link>
          {flag.kind === "quiet_client" && (
            <QuietClientNudgeButton athleteFirstName={flag.athleteName.split(" ")[0]} />
          )}
        </div>
      </div>
    );
  }

  if (emptyState) {
    return (
      <div className="border border-steel/20 bg-surface p-5">
        <p className="font-body text-[10px] text-steel uppercase tracking-wide font-bold mb-2">Right now</p>
        <p className="font-body text-lg text-chalk">{emptyState.text}</p>
        {emptyState.href && (
          <Link href={emptyState.href} className="font-body text-sm text-rust font-medium mt-3 inline-block">
            View profile →
          </Link>
        )}
      </div>
    );
  }

  return null;
}
