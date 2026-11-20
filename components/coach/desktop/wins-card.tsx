import Link from "next/link";
import { InitialsAvatar } from "@/components/shared/initials-avatar";
import type { WinRow } from "@/lib/home-greeting";

// Wins on Home (Look Refresh, Ron Nov 20): who trained in the last few days, on a green-tinted card. Shows nothing when no one has.
export function WinsCard({ wins }: { wins: WinRow[] }) {
  if (wins.length === 0) return null;
  return (
    <section className="tint-win rounded-card p-4 mb-6" aria-labelledby="wins-heading" data-wins-card>
      <h2 id="wins-heading" className="font-body text-[13px] font-semibold text-win mb-2">
        Wins
      </h2>
      <ul className="flex flex-col gap-1">
        {wins.map((w) => (
          <li key={w.athleteId}>
            <Link prefetch={false} href={`/groups/${w.groupId}/athletes/${w.athleteId}`} className="flex items-center gap-3 min-h-11 font-body text-sm text-chalk hover:underline underline-offset-2">
              <InitialsAvatar name={w.fullName} tintKey={w.athleteId} className="w-8 h-8 text-xs" />
              <span className="min-w-0">{w.line}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
