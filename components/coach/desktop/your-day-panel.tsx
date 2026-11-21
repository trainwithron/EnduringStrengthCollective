import Link from "next/link";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { dateKeyInZone } from "@/lib/timezone";
import type { ScheduleEntry } from "@/lib/your-day";

// Today's sessions, classes and calendar events on a coach's Home, in order. What needs the coach is one list only, Needs you at the top of Home (clutter audit DK5, Nov 21: this
// panel's own "N things need you" column was a second copy of it). The section is called Today, like the Home tab (DK30). In the schedule, the NAME opens the client's profile (a
// class opens its group sessions) and the TIME opens the coach's calendar on that day.
export function scheduleCalendarHref(entry: { groupId: string; startAt: string }, timezone: string): string {
  return `/groups/${entry.groupId}/calendar/${dateKeyInZone(timezone, new Date(entry.startAt))}`;
}

export function YourDayPanel({ schedule, timezone }: { schedule: ScheduleEntry[]; timezone: string }) {
  return (
    <section aria-labelledby="your-day-heading" className="mb-6">
      <div className="border border-transparent bg-surface p-4">
        <h2 id="your-day-heading" className="font-body text-[15px] font-semibold text-chalk mb-3">
          Today
        </h2>
        {schedule.length === 0 ? (
          <p className="font-body text-sm text-steel">Nothing on the calendar today.</p>
        ) : (
          <ul className="space-y-2">
            {schedule.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3">
                <Link prefetch={false} href={e.href} className="min-w-0 group">
                  <span className="font-body text-sm text-chalk group-hover:underline">{e.title}</span>
                  {e.kind === "class" && <span className="font-body text-xs text-steel ml-2">Class</span>}
                  {e.kind === "event" && <span className="font-body text-xs text-rust-ink ml-2">Event</span>}
                  {e.needsPayment && (
                    <span className="ml-2 font-body text-xs text-rust-ink border border-rust/50 rounded-token-pill px-1.5 py-0.5">Needs payment</span>
                  )}
                  <span className="block font-body text-xs text-steel truncate">{e.detail}</span>
                </Link>
                <Link prefetch={false}
                  href={scheduleCalendarHref(e, timezone)}
                  aria-label={e.allDay ? `Open the calendar for ${e.title}, all day` : `Open the calendar for ${e.title} at ${formatInTimezone(e.startAt, timezone, "time")}`}
                  className="font-body text-xs text-steel shrink-0 tabular-nums min-h-11 min-w-11 inline-flex items-center justify-end hover:text-chalk hover:underline"
                >
                  {e.allDay ? "All day" : formatInTimezone(e.startAt, timezone, "time")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
