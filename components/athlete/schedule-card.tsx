import Link from "next/link";
import { sessionsAvailableLine } from "@/lib/schedule-card";

const BUTTON = "inline-flex items-center justify-center min-h-11 px-5 bg-rust text-graphite font-body text-sm font-medium shrink-0";

// Top of a client's Calendar: how many sessions they can still book, and one button to the soonest open day (lib/schedule-card.ts).
// `preview`: the coach's read-only "View as client" copy, same look with the button switched off.
export function ScheduleCard({ available, href, preview = false, note = null }: { available: number; href: string; preview?: boolean; note?: string | null }) {
  return (
    <section className={preview ? "mb-4" : "px-5 pt-4"} aria-label="Schedule a session" data-schedule-card>
      <div className="border border-steel/20 p-3 flex items-center justify-between gap-3">
        <p className="font-body text-sm text-chalk">
          {sessionsAvailableLine(available)}
          {/* the coach's cap reached this week (Oct 23) */}
          {note && <span className="block font-body text-xs text-amber mt-0.5" data-fully-booked>{note}</span>}
        </p>
        {preview ? (
          <button type="button" disabled title="Your client taps this" className={`${BUTTON} cursor-not-allowed`}>
            Schedule
          </button>
        ) : (
          <Link href={href} className={BUTTON}>
            Schedule
          </Link>
        )}
      </div>
    </section>
  );
}
