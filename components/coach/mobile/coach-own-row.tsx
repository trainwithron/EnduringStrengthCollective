import Link from "next/link";
import { initialsOf } from "@/lib/initials";

// The coach's own training, as a client of themselves: one row, always first in the phone Clients list (Athletes on a team coach home). It is not a client of any organization, so it is outside the count and the
// list below it. Tapping it opens their own client app (their personal space), which carries the Back to coach home button. This is the ONE way into it from the coach side on a phone.
export const COACH_OWN_ROW_HREF = "/my-space?view=client";

export function CoachOwnRow({ name }: { name: string }) {
  return (
    <Link href={COACH_OWN_ROW_HREF} className="flex items-center gap-3 min-h-14 border border-steel/25 bg-surface/40 active:border-rust px-3 py-2 mb-4">
      <span className="w-10 h-10 rounded-full bg-graphite border border-steel/30 flex items-center justify-center shrink-0 font-display text-xs" aria-hidden="true">
        {initialsOf(name)}
      </span>
      <span className="font-body text-sm font-medium text-chalk truncate">{name} (you)</span>
    </Link>
  );
}
