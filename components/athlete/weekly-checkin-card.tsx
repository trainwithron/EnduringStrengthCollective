import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { checkinPath, coachLabel } from "@/lib/weekly-checkin";

// The weekly check-in on a client's Home (Ron, Nov 20: R2): Friday through Monday while this week's is not sent (lib/client-home-asks.ts). The whole card opens the check-in.
export function WeeklyCheckinCard({ groupId, coachName }: { groupId: string; coachName: string | null }) {
  return (
    <Link href={checkinPath(groupId)} className="flex items-center gap-3 tint-checkin rounded-card px-4 py-3 active:opacity-80" data-weekly-checkin-card>
      <ClipboardCheck className="w-6 h-6 text-checkin shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-display font-semibold text-xl leading-tight text-chalk">Your weekly check-in</span>
        <span className="block font-body text-sm text-steel">About a minute. It goes to {coachLabel(coachName)}.</span>
      </span>
    </Link>
  );
}
