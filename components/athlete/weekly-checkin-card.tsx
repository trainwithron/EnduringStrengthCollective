import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { checkinPath, coachLabel } from "@/lib/weekly-checkin";

// The weekly check-in on a client's Home (Ron, Nov 20: R2): Friday through Monday while this week's is not sent (lib/client-home-asks.ts). The whole card opens the check-in.
// Once sent it stays as "Sent, change it" until the coach reviews it (audit C2, Nov 21), so the client can get back to it.
export function WeeklyCheckinCard({ groupId, coachName, sent = false }: { groupId: string; coachName: string | null; sent?: boolean }) {
  return (
    <Link href={checkinPath(groupId)} className="flex items-center gap-3 tint-checkin rounded-card px-4 py-3 active:opacity-80" data-weekly-checkin-card={sent ? "sent" : "due"}>
      <ClipboardCheck className="w-6 h-6 text-checkin shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        {sent ? (
          <>
            <span className="block font-display font-semibold text-xl leading-tight text-chalk">Check-in sent, change it</span>
            <span className="block font-body text-sm text-steel">You can change it until {coachLabel(coachName)} reviews it.</span>
          </>
        ) : (
          <>
            <span className="block font-display font-semibold text-xl leading-tight text-chalk">Your weekly check-in</span>
            <span className="block font-body text-sm text-steel">About a minute. It goes to {coachLabel(coachName)}.</span>
          </>
        )}
      </span>
    </Link>
  );
}
