// "You're booked for 3:00 PM", on the row the client just booked (audit C7, Nov 21): the day page shows it when it comes back from a booking (?booked=<start>).
export function JustBookedLine({ time }: { time: string }) {
  return (
    <span className="font-body text-sm font-semibold text-win" role="status" data-just-booked>
      You&apos;re booked for {time}
    </span>
  );
}
