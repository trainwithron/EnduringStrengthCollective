import Link from "next/link";
import { InitialsAvatar } from "@/components/shared/initials-avatar";

// The coach's own training, as a client of themselves: one row, always first in the phone Clients list (Athletes on a team coach home). It is not a client of any organization, so it is outside the count and the
// list below it. Tapping it opens their own client app (their personal space), which carries the Back to coach home button. This is the ONE way into it from the coach side on a phone.
export const COACH_OWN_ROW_HREF = "/my-space/home";

export function CoachOwnRow({ name }: { name: string }) {
  return (
    <Link href={COACH_OWN_ROW_HREF} className="flex items-center gap-3 min-h-14 border border-steel/25 bg-surface/40 active:border-rust px-3 py-2 mb-4">
      <InitialsAvatar name={name} tintKey={name} />
      <span className="font-body text-sm font-medium text-chalk truncate">{name} (you)</span>
    </Link>
  );
}
