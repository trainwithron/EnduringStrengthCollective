import Link from "next/link";
import { sessionsAvailableLine } from "@/lib/schedule-card";

// A full-width "Book a session" (Look Refresh, client Calendar, Ron Nov 20). The button keeps the org's own button shape (globals.css .bg-rust.text-graphite).
const BUTTON = "w-full inline-flex items-center justify-center min-h-[52px] px-5 bg-rust text-graphite font-body text-base font-semibold";

// A client's Calendar: how many sessions they can still book, and one button to the soonest open day (lib/schedule-card.ts). Shown only when booking is open
// (the coach's open hours and booking mode decide). `preview`: the coach's read-only "View as client" copy, same look with the button switched off.
export function ScheduleCard({ available, href, preview = false, note = null }: { available: number; href: string; preview?: boolean; note?: string | null }) {
  return (
    <section className={preview ? "mb-4" : "px-5 pt-5"} aria-label="Schedule a session" data-schedule-card>
      <div className="flex flex-col gap-2">
        <p className="font-body text-sm text-steel text-center">
          {sessionsAvailableLine(available)}
          {/* the coach's cap reached this week (Oct 23) */}
          {note && <span className="block font-body text-xs text-amber mt-0.5" data-fully-booked>{note}</span>}
        </p>
        {preview ? (
          <button type="button" disabled title="Your client taps this" className={`${BUTTON} cursor-not-allowed`}>
            Book a session
          </button>
        ) : (
          <Link href={href} className={BUTTON}>
            Book a session
          </Link>
        )}
      </div>
    </section>
  );
}
