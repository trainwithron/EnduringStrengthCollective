import Link from "next/link";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { dateKeyInZone } from "@/lib/timezone";
import { attentionHeadline, KIND_LABEL, rankAttention, type AttentionItem, type ScheduleEntry } from "@/lib/your-day";

// The first thing on a coach's Home: today's sessions and classes in order, and one ranked list of what needs them. Each row opens the
// place to act; the detailed panels further down (replies, payments, insights) are where the actions themselves live. In the schedule, the NAME opens the client's profile (a class opens its
// group sessions) and the TIME opens the coach's calendar on that day.
export function scheduleCalendarHref(entry: { groupId: string; startAt: string }, timezone: string): string {
  return `/groups/${entry.groupId}/calendar/${dateKeyInZone(timezone, new Date(entry.startAt))}`;
}

export function YourDayPanel({
  schedule,
  attention,
  timezone,
  showPayments = true,
}: {
  schedule: ScheduleEntry[];
  attention: AttentionItem[];
  timezone: string;
  /** false for a team organization: nothing about payments on its Home */
  showPayments?: boolean;
}) {
  const { shown, hidden } = rankAttention(attention, 6);
  return (
    <section aria-labelledby="your-day-heading" className="mb-6 grid gap-4 md:grid-cols-2">
      <div className="border border-steel/20 bg-surface p-4">
        <h2 id="your-day-heading" className="font-display uppercase text-sm tracking-wide text-steel mb-3">
          Your day
        </h2>
        {schedule.length === 0 ? (
          <p className="font-body text-sm text-steel">Nothing on the calendar today.</p>
        ) : (
          <ul className="space-y-2">
            {schedule.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3">
                <Link href={e.href} className="min-w-0 group">
                  <span className="font-body text-sm text-chalk group-hover:underline">{e.title}</span>
                  {e.kind === "class" && <span className="font-body text-xs text-steel ml-2">Class</span>}
                  {e.needsPayment && (
                    <span className="ml-2 font-body text-xs text-rust border border-rust/50 rounded-token-pill px-1.5 py-0.5">Needs payment</span>
                  )}
                  <span className="block font-body text-xs text-steel truncate">{e.detail}</span>
                </Link>
                <Link
                  href={scheduleCalendarHref(e, timezone)}
                  aria-label={`Open the calendar for ${e.title} at ${formatInTimezone(e.startAt, timezone, "time")}`}
                  className="font-body text-xs text-steel shrink-0 tabular-nums min-h-11 min-w-11 inline-flex items-center justify-end hover:text-chalk hover:underline"
                >
                  {formatInTimezone(e.startAt, timezone, "time")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border border-steel/20 bg-surface p-4">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">{attentionHeadline(attention.length)}</h2>
        {shown.length === 0 ? (
          <p className="font-body text-sm text-steel">{showPayments ? "Replies, payments and check-ins that need you will show up here." : "Replies and check-ins that need you will show up here."}</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((a) => (
              <li key={a.id}>
                <Link href={a.href} className="flex items-baseline gap-3 group">
                  <span className="font-body text-xs text-steel w-16 shrink-0">{KIND_LABEL[a.kind]}</span>
                  <span className="min-w-0">
                    <span className="font-body text-sm text-chalk group-hover:underline">{a.text}</span>
                    {a.detail && <span className="block font-body text-xs text-steel truncate">{a.detail}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && <p className="font-body text-xs text-steel mt-3">and {hidden} more below</p>}
      </div>
    </section>
  );
}
