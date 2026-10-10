import Link from "next/link";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { getCoachedGroups } from "@/lib/coach-groups";
import { pickCoachAnchor } from "@/lib/coach-anchor";

// The Group tab's calendar, from a coach-level page: it never guesses a group. With one group it goes straight to that group's calendar; with several, the coach picks
// which first, so a calendar can never show the wrong group's name.
export default async function PickGroupCalendarPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const all = await getCoachedGroups(supabase, user.id);
  const groups = all.filter((g) => g.kind !== "one_on_one").sort((a, b) => a.name.localeCompare(b.name));
  const anchor = pickCoachAnchor(all);
  if (!anchor) return <NoAccess>Only coaches have a group calendar.</NoAccess>;
  if (groups.length === 1) redirect(`/groups/${groups[0].id}/group-calendar`);

  return (
    <CoachDesktopShell groupId={anchor.id} groupName={anchor.name} active="group-calendar" coachLevel>
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          <SwappableTerm termKey="group" form="singular" className="capitalize" /> calendar
        </h1>
        <p className="font-body text-sm text-steel mt-2">Which one?</p>
      </div>
      {groups.length === 0 ? (
        <p className="font-body text-sm text-steel">You don&apos;t coach a group yet.</p>
      ) : (
        <ul className="space-y-2 max-w-md">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}/group-calendar`} className="block min-h-11 px-3 py-3 border border-steel/25 bg-surface font-body text-sm text-chalk hover:border-rust">
                {g.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CoachDesktopShell>
  );
}
