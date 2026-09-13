import Link from "next/link";
import type { HeroFlag } from "@/lib/coach-hero-priority";
import type { HeroEmptyState } from "@/lib/dashboard-data";

const TIER_LABEL: Record<"mild" | "strong", string> = {
  mild: "hasn't logged in a while",
  strong: "has gone quiet — worth a personal check-in",
};

function sentenceFor(flag: HeroFlag): string {
  if (flag.kind === "low_readiness") {
    return `${flag.athleteName} logged low readiness today — worth a lighter session or a check-in.`;
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
export function DashboardHero({ flag, emptyState }: { flag: (HeroFlag & { href: string }) | null; emptyState: HeroEmptyState | null }) {
  if (flag) {
    return (
      <div className="border border-rust/40 bg-rust/5 p-5">
        <p className="font-body text-[10px] text-rust uppercase tracking-wide font-bold mb-2">Right now</p>
        <p className="font-body text-lg text-chalk mb-3">{sentenceFor(flag)}</p>
        <Link href={flag.href} className="font-body text-sm text-rust font-medium">
          View {flag.athleteName.split(" ")[0]}&apos;s profile →
        </Link>
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
