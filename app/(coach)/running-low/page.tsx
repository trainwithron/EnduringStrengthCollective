import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { groupsInOrgOf } from "@/lib/coach-groups";
import { CHOOSE_ORGANIZATION_PATH, getActiveAnchor } from "@/lib/active-anchor";
import { getCoachClients } from "@/lib/coach-clients";
import { chunk } from "@/lib/chunk";
import { addSessionsHref, RUNNING_LOW_AT, RUNNING_LOW_PATH } from "@/lib/add-sessions-link";
import { fetchInactiveKeys, inactiveKey } from "@/lib/inactive-ids";

export const metadata = { title: "Running low" };

// The page the "N clients are running low" notice opens: the clients of the open organization with 1 session left or none, each with a button that goes straight to where sessions are added. Reads only.
export default async function RunningLowPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActiveAnchor(supabase, user.id);
  if (active?.needsChoice) redirect(`${CHOOSE_ORGANIZATION_PATH}?next=${RUNNING_LOW_PATH}`);
  const anchor = active?.anchor ?? null;
  if (!anchor) {
    return (
      <NoAccess>
        Only coaches have a <SwappableTerm termKey="client" /> list.
      </NoAccess>
    );
  }

  const clients = await getCoachClients(supabase, user.id, anchor.id);
  const groupIds = Array.from(new Set(clients.map((c) => c.groupId)));
  const [creditBatches, setAside] = await Promise.all([
    Promise.all(chunk(clients.map((c) => c.id), 100).map((ids) => supabase.from("session_credits").select("athlete_id, group_id, balance, payment_hold").in("athlete_id", ids))),
    fetchInactiveKeys(supabase, groupIds),
  ]);
  const balance = new Map(creditBatches.flatMap((r) => r.data ?? []).map((r: any) => [`${r.athlete_id}:${r.group_id}`, { balance: r.balance as number, hold: r.payment_hold === true }]));

  const low = clients
    .map((c) => ({ c, credit: balance.get(`${c.id}:${c.groupId}`) }))
    .filter((x) => x.credit && x.credit.balance <= RUNNING_LOW_AT && !x.credit.hold && !setAside.has(inactiveKey(x.c.groupId, x.c.id)))
    .sort((a, b) => (a.credit!.balance - b.credit!.balance) || a.c.fullName.localeCompare(b.c.fullName));

  return (
    <CoachDesktopShell groupId={anchor.id} groupName={anchor.name} active="clients" coachLevel>
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Running low</h1>
        <p className="font-body text-sm text-steel mt-3">
          <SwappableTerm termKey="client" form="plural" /> with one session left or none. Add sessions goes straight to where you add them.
        </p>
      </div>
      {low.length === 0 ? (
        <p className="font-body text-sm text-steel border border-steel/20 p-4">No one is running low right now.</p>
      ) : (
        <ul className="divide-y divide-steel/15 border-y border-steel/15 max-w-2xl" data-running-low>
          {low.map(({ c, credit }) => (
            <li key={`${c.id}:${c.groupId}`} className="flex items-center justify-between gap-3 py-3 px-1">
              <span className="min-w-0">
                <span className="block font-body text-base text-chalk break-words">{c.fullName}</span>
                <span className="block font-body text-xs text-steel">{credit!.balance <= 0 ? "Out of sessions" : "1 session left"}</span>
              </span>
              <Link href={addSessionsHref(c.groupId, c.id)} className="shrink-0 h-11 px-4 inline-flex items-center bg-rust text-graphite font-display uppercase text-sm font-bold">
                Add sessions
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6">
        <Link href="/clients" className="font-body text-xs text-steel underline underline-offset-2">
          All <SwappableTerm termKey="client" form="plural" />
        </Link>
      </p>
    </CoachDesktopShell>
  );
}
