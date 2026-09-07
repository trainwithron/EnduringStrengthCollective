import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function monthLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export default async function CoachCalendarPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams: { month?: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can view this calendar.</p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const today = new Date();
  const monthParam = searchParams.month;
  let year = today.getFullYear();
  let monthIndex = today.getMonth();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    year = y;
    monthIndex = m - 1;
  }

  const firstOfMonth = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();

  // Every confirmed booking this coach has this month, across every
  // client — the actual "what does my schedule look like" view, distinct
  // from Availability (which just configures the recurring hours).
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("id, start_at, athlete_id, profiles ( full_name )")
    .eq("coach_id", user.id)
    .eq("status", "confirmed")
    .gte("start_at", firstOfMonth.toISOString())
    .lt("start_at", new Date(year, monthIndex + 1, 1).toISOString())
    .order("start_at", { ascending: true });

  const bookingsByDateKey = new Map<string, { time: string; name: string }[]>();
  for (const b of (bookingRows ?? []) as any[]) {
    const d = new Date(b.start_at);
    const key = dateKey(d);
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const name = b.profiles?.full_name ?? "A client";
    if (!bookingsByDateKey.has(key)) bookingsByDateKey.set(key, []);
    bookingsByDateKey.get(key)!.push({ time, name });
  }

  // Quick-jump roster — each client's own habits/macros/workout-override
  // calendar lives on their profile, this is just a fast way in.
  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("profile_id, profiles ( full_name, avatar_url )")
    .eq("group_id", params.groupId)
    .eq("role", "athlete");

  const clients = (memberships ?? [])
    .map((m: any) => ({
      profileId: m.profile_id,
      fullName: m.profiles?.full_name ?? "Unknown",
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, monthIndex, i + 1)),
  ];

  const prevMonth = new Date(year, monthIndex - 1, 1);
  const nextMonth = new Date(year, monthIndex + 1, 1);
  const basePath = `/groups/${params.groupId}/calendar`;
  const prevHref = `${basePath}?month=${prevMonth.getFullYear()}-${String(
    prevMonth.getMonth() + 1
  ).padStart(2, "0")}`;
  const nextHref = `${basePath}?month=${nextMonth.getFullYear()}-${String(
    nextMonth.getMonth() + 1
  ).padStart(2, "0")}`;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="calendar">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Calendar</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Your booked 1-on-1 sessions across every client this month. Set
          your recurring hours on Availability — this is what's actually on
          the books.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_260px] gap-8 items-start">
        <div>
          <div className="flex items-center justify-between mb-3">
            <Link href={prevHref} className="font-body text-xs text-rust uppercase tracking-wide">
              &larr; Prev
            </Link>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel">
              {monthLabel(year, monthIndex)}
            </h2>
            <Link href={nextHref} className="font-body text-xs text-rust uppercase tracking-wide">
              Next &rarr;
            </Link>
          </div>

          <div className="grid grid-cols-7 gap-px bg-steel/15 border border-steel/15">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="bg-graphite text-center font-body text-[10px] text-steel uppercase tracking-wide py-1.5"
              >
                {label}
              </div>
            ))}

            {cells.map((date, i) => {
              if (!date) return <div key={i} className="bg-graphite min-h-[80px]" />;

              const key = dateKey(date);
              const isToday = key === dateKey(today);
              const bookings = bookingsByDateKey.get(key) ?? [];

              return (
                <div
                  key={i}
                  className={`bg-graphite min-h-[80px] p-1.5 flex flex-col gap-0.5 ${
                    isToday ? "ring-1 ring-inset ring-rust" : ""
                  }`}
                >
                  <span
                    className={`font-body text-[10px] ${
                      isToday ? "text-rust font-bold" : "text-steel"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  {bookings.slice(0, 3).map((b, idx) => (
                    <span key={idx} className="font-body text-[9px] text-chalk leading-tight">
                      {b.time} &middot; {b.name}
                    </span>
                  ))}
                  {bookings.length > 3 && (
                    <span className="font-body text-[9px] text-steel">
                      +{bookings.length - 3} more
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            Client calendars
          </h2>
          {clients.length === 0 ? (
            <p className="font-body text-sm text-steel">No clients yet.</p>
          ) : (
            <div className="divide-y divide-steel/15">
              {clients.map((c) => (
                <Link
                  key={c.profileId}
                  href={`/groups/${params.groupId}/athletes/${c.profileId}/calendar`}
                  className="flex items-center justify-between py-2.5 font-body text-sm"
                >
                  {c.fullName}
                  <span className="text-rust text-xs">Open &rarr;</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </CoachDesktopShell>
  );
}
