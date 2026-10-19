import Link from "next/link";

// On a client's Calendar when the coach schedules everyone (booking mode "I schedule everyone"): the calendar says so, and the way to ask is one tap, instead of a calendar with no sign of how to set up a session.
export function BookingModeLine({ groupId }: { groupId: string }) {
  return (
    <section className="px-5 pt-4" aria-label="Scheduling sessions with your coach">
      <p className="font-body text-sm text-steel">Your coach schedules your sessions with you. Message them to set one up.</p>
      <Link href={`/groups/${groupId}/messages`} className="inline-flex items-center justify-center min-h-11 px-5 mt-2 border border-rust text-rust font-body text-sm">
        Message your coach
      </Link>
    </section>
  );
}
