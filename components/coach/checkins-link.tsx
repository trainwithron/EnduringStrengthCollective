import Link from "next/link";
import { COACH_CHECKINS_PATH } from "@/lib/weekly-checkin";

// "Check-ins (n)" in the Clients page header, beside Requests (Ron, Nov 20: R2): always there once the database has check-ins, with a dot when some wait for review.
export function CheckinsLink({ count }: { count: number | null }) {
  if (count === null) return null;
  const waiting = count > 0;
  return (
    <Link
      href={COACH_CHECKINS_PATH}
      className={`inline-flex items-center gap-2 h-11 px-4 border font-body text-sm ${waiting ? "border-alert text-chalk" : "border-steel/40 text-steel"}`}
      aria-label={waiting ? `Check-ins, ${count} to review` : "Check-ins"}
    >
      Check-ins <span>({count})</span>
      {waiting && <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-alert" />}
    </Link>
  );
}
