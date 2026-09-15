import Link from "next/link";
import type { TeamPulseResult } from "@/lib/dashboard-data";

function pulseColor(pulse: number): string {
  if (pulse >= 70) return "text-positive";
  if (pulse >= 40) return "text-chalk";
  return "text-rust";
}

// One gauge per real team-mode group, never blended across groups or
// across 1-on-1 clients (the exact mistake that made a real CoachRx
// complaint feel meaningless). A group with no roster, or with zero
// real data behind every component, shows a plain dash rather than a
// fabricated number.
export function TeamPulseCard({ team }: { team: TeamPulseResult }) {
  return (
    <Link
      href={`/groups/${team.groupId}/dashboard`}
      className="flex items-center justify-between border border-steel/30 bg-surface p-4 hover:border-rust/50 transition-colors"
    >
      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide">
          Team Pulse{team.orgName && ` — ${team.orgName}`}
        </p>
        <p className="font-body text-sm text-chalk mt-1">{team.groupName}</p>
      </div>
      <p className={`font-display font-bold text-3xl leading-none ${team.pulse != null ? pulseColor(team.pulse) : "text-steel"}`}>
        {team.pulse != null ? team.pulse : "—"}
      </p>
    </Link>
  );
}
