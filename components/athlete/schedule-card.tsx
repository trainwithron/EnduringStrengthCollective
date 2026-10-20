import Link from "next/link";
import { sessionsAvailableLine } from "@/lib/schedule-card";

// Top of a client's Calendar: how many sessions they can still book, and one button to the soonest open day (lib/schedule-card.ts).
export function ScheduleCard({ available, href }: { available: number; href: string }) {
  return (
    <section className="px-5 pt-4" aria-label="Schedule a session" data-schedule-card>
      <div className="border border-steel/20 p-3 flex items-center justify-between gap-3">
        <p className="font-body text-sm text-chalk">{sessionsAvailableLine(available)}</p>
        <Link href={href} className="inline-flex items-center justify-center min-h-11 px-5 bg-rust text-graphite font-body text-sm font-medium shrink-0">
          Schedule
        </Link>
      </div>
    </section>
  );
}
