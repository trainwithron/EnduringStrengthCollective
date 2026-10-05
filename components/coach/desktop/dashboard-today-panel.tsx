import Link from "next/link";
import type { TodayBooking } from "@/lib/dashboard-data";

export function DashboardTodayPanel({ bookings }: { bookings: TodayBooking[] }) {
  return (
    <div className="border border-steel/20 bg-surface p-4">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Today</h2>
      {bookings.length === 0 ? (
        <p className="font-body text-sm text-steel">Nothing booked today.</p>
      ) : (
        <div className="space-y-2">
          {bookings.map((b) => (
            <div key={b.id} className="flex items-center justify-between">
              <p className="font-body text-sm text-chalk">
                {b.athleteName}
                {b.needsPayment && (
                  <Link
                    href={`/groups/${b.groupId}/athletes/${b.athleteId}`}
                    className="ml-2 font-body text-xs text-rust border border-rust/50 rounded-token-pill px-1.5 py-0.5"
                    title="Out of sessions. Open their profile to add sessions or send a reminder."
                  >
                    Needs payment
                  </Link>
                )}
              </p>
              <p className="font-body text-xs text-steel">
                {new Date(b.startAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · {b.groupName}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
