import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { CHOOSE_ORGANIZATION_PATH, getActiveAnchor } from "@/lib/active-anchor";
import { readRowsByIds } from "@/lib/read-by-ids";
import { DEFAULT_COACH_TIMEZONE, dateKeyInZone } from "@/lib/timezone";
import { formatInTimezone, isValidTimeZone } from "@/lib/format-in-timezone";
import { bookingDayHref, RECURRING_CONFLICTS_PATH } from "@/lib/notice-links";

export const metadata = { title: "Recurring sessions to resolve" };

// The page the "N recurring sessions no longer fit your available hours" notice opens when there is more than one: each session that needs a decision, with a button to its day,
// where its choices (keep it anyway, or cancel it) are already open. Reads only.
export default async function RecurringConflictsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActiveAnchor(supabase, user.id);
  if (active?.needsChoice) redirect(`${CHOOSE_ORGANIZATION_PATH}?next=${RECURRING_CONFLICTS_PATH}`);
  const anchor = active?.anchor ?? null;
  if (!active || !anchor) {
    return <NoAccess>Only coaches have recurring sessions to resolve.</NoAccess>;
  }

  // The open organization's groups only (another organization's appear after switching to it).
  const orgGroupIds = active.groups.filter((g) => g.orgId === active.orgId).map((g) => g.id);
  const [{ data: profile }, { data: rows }] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    readRowsByIds(orgGroupIds, (g) => (from, to) =>
      supabase
        .from("bookings")
        .select("id, group_id, start_at, profiles!bookings_athlete_id_fkey ( full_name )")
        .eq("coach_id", user.id)
        .eq("needs_coach_resolution", true)
        .eq("status", "confirmed")
        .gt("start_at", new Date().toISOString())
        .in("group_id", g)
        .order("start_at")
        .order("id")
        .range(from, to)
    ),
  ]);
  const timezone = isValidTimeZone(profile?.timezone) ? (profile!.timezone as string) : DEFAULT_COACH_TIMEZONE;
  const conflicts = ((rows ?? []) as { id: string; group_id: string; start_at: string; profiles: { full_name: string | null } | null }[]).sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <CoachDesktopShell groupId={anchor.id} groupName={anchor.name} active="calendar" coachLevel>
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Recurring sessions to resolve</h1>
        <p className="font-body text-sm text-steel mt-3">These no longer fit your available hours. Open one to keep it anyway or cancel it.</p>
      </div>
      {conflicts.length === 0 ? (
        <p className="font-body text-sm text-steel border border-steel/20 p-4">Nothing to resolve right now.</p>
      ) : (
        <ul className="divide-y divide-steel/15 border-y border-steel/15 max-w-2xl" data-recurring-conflicts>
          {conflicts.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-3 px-1">
              <span className="min-w-0">
                <span className="block font-body text-base text-chalk break-words">{b.profiles?.full_name ?? <SwappableTerm termKey="client" cap />}</span>
                <span className="block font-body text-xs text-steel">{formatInTimezone(new Date(b.start_at), timezone, "dateTime")}</span>
              </span>
              <Link href={bookingDayHref(b.group_id, dateKeyInZone(timezone, new Date(b.start_at)), b.id)} className="shrink-0 h-11 px-4 inline-flex items-center bg-rust text-graphite font-display uppercase text-sm font-bold">
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CoachDesktopShell>
  );
}
