import Link from "next/link";

export interface MyScheduleCardState {
  summary: string; // "Tuesdays at 6:00 AM, 60 minutes"
  state: string; // "Active", "Paused", "Frozen until Nov 3"
  waiting: boolean; // a request is waiting for the coach
}

// On Home, for a client with a weekly schedule: one obvious place to look at it and ask for a pause, a freeze or to cancel.
export function MyScheduleCard({ groupId, state }: { groupId: string; state: MyScheduleCardState }) {
  return (
    <Link href={`/groups/${groupId}/my-schedule`} className="block min-h-11 border border-steel/30 bg-surface/40 px-4 py-3" aria-label="My schedule">
      <p className="font-body text-xs uppercase tracking-wider text-steel">My schedule</p>
      <p className="font-body text-sm text-chalk mt-1">
        {state.summary} · {state.state}
      </p>
      {state.waiting && <p className="font-body text-xs text-steel mt-1">Your request is with your coach.</p>}
    </Link>
  );
}
