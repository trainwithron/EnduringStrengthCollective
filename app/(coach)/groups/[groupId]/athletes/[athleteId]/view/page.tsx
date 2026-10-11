import Link from "next/link";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { loadCalendar, loadHistory, loadHome, loadPrograms } from "@/lib/client-preview-data";
import { formatShortDate } from "@/lib/program-schedule";
import { ViewAsClientLabel } from "@/components/coach/desktop/view-as-client-label";

// "View as client" (desktop): the coach sees roughly what the client sees, read only, in a phone-width frame. Everything here is a plain server-rendered read: there is no form,
// no button that saves anything and no write code at all, so nothing can change from this page. The client is named in the address and the page first checks that the viewer
// coaches this group and that the client is an athlete in it; no impersonation cookie is used. The same rule as the client's profile page: the viewer must coach this group.

const TABS = [
  { key: "home", label: "Home" },
  { key: "programs", label: "Programs" },
  { key: "history", label: "History" },
  { key: "calendar", label: "Calendar" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function ViewAsClientPage(props: {
  params: Promise<{ groupId: string; athleteId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await props.params;
  const search = await props.searchParams;
  const tab: TabKey = TABS.some((t) => t.key === search.tab) ? (search.tab as TabKey) : "home";

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: viewer }, { data: client }, { data: group }] = await Promise.all([
    supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle(),
    supabase.from("group_memberships").select("role, profiles ( full_name, avatar_url )").eq("group_id", params.groupId).eq("profile_id", params.athleteId).maybeSingle(),
    supabase.from("groups").select("name").eq("id", params.groupId).maybeSingle(),
  ]);
  if (viewer?.role !== "coach" || client?.role !== "athlete") {
    return <NoAccess>You can only view a client you coach.</NoAccess>;
  }
  const profile = client.profiles as unknown as { full_name?: string | null; avatar_url?: string | null } | null;
  const name = profile?.full_name ?? "this client";
  const first = name.split(/\s+/)[0] || name;

  // "Change": every client in every group this coach coaches (RLS limits what is visible; only groups the coach coaches are asked for).
  const { data: coached } = await supabase.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach");
  const coachedIds = ((coached ?? []) as { group_id: string }[]).map((g) => g.group_id);
  const { data: others } = coachedIds.length
    ? await supabase.from("group_memberships").select("group_id, profile_id, profiles ( full_name )").in("group_id", coachedIds).eq("role", "athlete").limit(200)
    : { data: [] as any[] };
  const choices = ((others ?? []) as any[])
    .map((r) => ({ groupId: r.group_id as string, athleteId: r.profile_id as string, name: (r.profiles?.full_name ?? "Client") as string }))
    .filter((c) => c.athleteId !== params.athleteId)
    .sort((a, b) => a.name.localeCompare(b.name));

  const here = `/groups/${params.groupId}/athletes/${params.athleteId}`;

  let body: React.ReactNode = null;
  if (tab === "home") {
    const home = await loadHome(supabase, params.groupId, params.athleteId);
    const cards = home.todays.cards;
    body = (
      <div className="space-y-4">
        <div>
          <p className="font-display font-bold text-2xl uppercase leading-none">Hi, {first}</p>
          <p className="font-body text-xs text-steel mt-1">{home.doneThisWeek} {home.doneThisWeek === 1 ? "workout" : "workouts"} done this week</p>
        </div>
        <div>
          <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Today</p>
          {home.todays.overrideWorkoutId ? (
            <p className="font-body text-sm border border-steel/20 p-3">A workout was assigned for today.</p>
          ) : cards.length > 0 ? (
            <ul className="space-y-2">
              {cards.map((c) => (
                <li key={c.programId} className="border border-steel/20 p-3">
                  <p className="font-body text-xs text-rust uppercase tracking-wide">{c.heading}</p>
                  <p className="font-display font-bold text-lg uppercase leading-tight mt-0.5">{c.title}</p>
                  <p className="font-body text-xs text-steel mt-1">{c.status === "done" ? "Done today" : "Ready to start"}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-body text-sm text-steel border border-steel/20 p-3">
              {home.todays.fallback.status === "locked"
                ? `Next workout unlocks ${formatShortDate(home.todays.fallback.unlocksOn)}.`
                : home.todays.fallback.status === "no-program"
                  ? "No program yet."
                  : "Nothing scheduled today."}
            </p>
          )}
        </div>
      </div>
    );
  } else if (tab === "programs") {
    const programs = await loadPrograms(supabase, params.groupId, params.athleteId);
    body =
      programs.length === 0 ? (
        <p className="font-body text-sm text-steel">No program yet.</p>
      ) : (
        <div className="space-y-4">
          {programs.map(({ program, days }) => (
            <details key={program.id} open className="border border-steel/20">
              <summary className="px-3 py-2 cursor-pointer font-display font-bold uppercase text-sm">{program.label ?? program.name}</summary>
              <ul className="divide-y divide-steel/15">
                {days.map((d) => (
                  <li key={d.id} className="px-3 py-2 flex items-center justify-between gap-2">
                    <span className="font-body text-sm truncate">
                      <span className="text-steel text-xs mr-1.5">W{d.weekNumber}</span>
                      {d.title}
                    </span>
                    <span className="font-body text-xs text-steel shrink-0">{d.done ? "Done" : d.date ? formatShortDate(d.date) : ""}</span>
                  </li>
                ))}
                {days.length === 0 && <li className="px-3 py-2 font-body text-xs text-steel">No workouts yet.</li>}
              </ul>
            </details>
          ))}
        </div>
      );
  } else if (tab === "history") {
    const logs = await loadHistory(supabase, params.groupId, params.athleteId);
    body =
      logs.length === 0 ? (
        <p className="font-body text-sm text-steel">No workouts logged yet.</p>
      ) : (
        <ul className="divide-y divide-steel/15 border border-steel/20">
          {logs.map((l) => (
            <li key={l.id} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display font-bold uppercase text-sm truncate">{l.title}</span>
                <span className="font-body text-xs text-steel shrink-0">{when(l.createdAt)}</span>
              </div>
              <p className="font-body text-xs text-steel mt-0.5">
                {l.sets != null ? `${l.sets} sets` : ""}
                {l.volume ? ` · ${Math.round(l.volume).toLocaleString("en-US")} lbs` : ""}
                {l.prCount > 0 ? ` · ${l.prCount} PR${l.prCount === 1 ? "" : "s"}` : ""}
                {l.loggedByCoach ? " · Coach logged" : ""}
              </p>
            </li>
          ))}
        </ul>
      );
  } else {
    const items = await loadCalendar(supabase, params.groupId, params.athleteId);
    body =
      items.length === 0 ? (
        <p className="font-body text-sm text-steel">Nothing scheduled in the next four weeks.</p>
      ) : (
        <ul className="divide-y divide-steel/15 border border-steel/20">
          {items.map((i) => (
            <li key={i.key} className="px-3 py-2.5 flex items-center justify-between gap-2">
              <span className="font-body text-sm truncate">
                {i.label}
                <span className="block text-xs text-steel">{i.detail}</span>
              </span>
              <span className="font-body text-xs text-steel shrink-0">{formatShortDate(i.date)}</span>
            </li>
          ))}
        </ul>
      );
  }

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="clients">
      <div className="flex flex-wrap items-start justify-center gap-8 pt-2">
        <div data-testid="client-preview-frame" className="w-[390px] max-w-full border-[10px] border-surface rounded-[36px] bg-graphite overflow-hidden shadow-xl flex flex-col h-[760px]">
          <div className="shrink-0 bg-chalk/10 px-4 py-2.5 flex items-center justify-between gap-2">
            <p className="font-body text-xs truncate">
              Viewing as <span className="font-semibold">{name}</span>
            </p>
            <div className="flex items-center gap-3 shrink-0 font-body text-xs">
              <details className="relative">
                <summary className="cursor-pointer text-rust underline underline-offset-2 list-none">Change</summary>
                <ul className="absolute right-0 top-full mt-1 z-20 w-56 max-h-64 overflow-y-auto border border-steel/30 bg-graphite shadow-lg">
                  {choices.length === 0 && <li className="px-3 py-2 text-steel">No other clients.</li>}
                  {choices.map((c) => (
                    <li key={`${c.groupId}-${c.athleteId}`}>
                      <Link href={`/groups/${c.groupId}/athletes/${c.athleteId}/view?tab=${tab}`} className="block px-3 py-2 hover:bg-surface truncate">
                        {c.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
              <Link href={here} className="text-rust underline underline-offset-2">
                Exit
              </Link>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">{body}</div>
          <nav aria-label="Client app" className="shrink-0 grid grid-cols-4 border-t border-steel/20 bg-surface">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`/groups/${params.groupId}/athletes/${params.athleteId}/view?tab=${t.key}`}
                aria-current={t.key === tab ? "page" : undefined}
                className={`py-3 text-center font-body text-xs ${t.key === tab ? "text-rust font-semibold" : "text-steel"}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>

        <aside className="w-56 space-y-3 pt-2">
          <p className="font-body text-xs text-steel">
            A read-only look at what <ViewAsClientLabel /> sees. Nothing here can be changed.
          </p>
          <Link href={here} className="w-full h-11 flex items-center justify-center border border-steel/40 text-chalk font-body text-sm">
            Open full profile
          </Link>
        </aside>
      </div>
    </CoachDesktopShell>
  );
}
