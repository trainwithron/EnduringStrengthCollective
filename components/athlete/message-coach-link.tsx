import Link from "next/link";

// The way to reach the coach from a calendar page that has nothing to book: a client who sees "No open hours on this day" or "Your coach schedules your sessions" needs the next step in one tap (Oct 19 audit: the
// page said "Message them" with no way to).
export function MessageCoachLink({ groupId }: { groupId: string }) {
  return (
    <Link href={`/groups/${groupId}/messages`} className="inline-flex items-center h-11 mt-2 px-4 border border-rust text-rust font-body text-sm">
      Message your coach
    </Link>
  );
}
