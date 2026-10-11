import Link from "next/link";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { loadCalendar, loadHistory, loadHome, loadNutrition, loadPrograms } from "@/lib/client-preview-data";
import { dayStatus, programProgress, progressLine } from "@/lib/client-preview-program";
import { formatShortDate } from "@/lib/program-schedule";
import { ViewAsClientLabel } from "@/components/coach/desktop/view-as-client-label";

// "View as client" (desktop): the coach sees roughly what the client sees, read only, in a phone-width frame. Everything here is a plain server-rendered read: there is no form,
// no button that saves anything and no write code at all, so nothing can change from this page. The client is named in the address and the page first checks that the viewer
// coaches this group and that the client is an athlete in it; no impersonation cookie is used. The same rule as the client's profile page: the viewer must coach this group.
// The tabs mirror the client's own bottom bar (Home, Calendar, Nutrition) plus History.

const TABS = [
  { key: "home", label: "Home" },
  { key: "calendar", label: "Calendar" },
  { key: "nutrition", label: "Nutrition" },
  { key: "history", label: "History" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const EMPTY = {
  noProgram: "Nothing assigned yet",
  noWorkouts: "No workouts yet",
  noSchedule: "Nothing scheduled",
  noNutrition: "No nutrition set up yet",
  loadFailed: "Couldn't load this right now",
} as const;

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const Empty = ({ children }: { children: React.ReactNode }) => <p className="font-body text-sm text-steel border border-steel/20 p-3">{children}</p>;

// A read that fails shows a plain line instead of an error page or a blank screen.
async function safely<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export default async function ViewAsClientPage(props: {
  params: Promise<{ groupId: string; athleteId: string }>;
  searchParams: Promise<{ tab?: string; program?: string }>;
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
  const viewBase = `${here}/view`;

  let body: React.ReactNode = null;
  if (tab === "home") {
    const [home, programs] = await Promise.all([safely(() => loadHome(supabase, params.groupId, params.athleteId)), safely(() => loadPrograms(supabase, params.groupId, params.athleteId))]);
    const chosen = search.program ? (programs ?? []).find((p) => p.program.id === search.program) : null;

    if (chosen) {
      // The full program, read only: every week and day, what is done, what is available now and what unlocks later.
      const today = new Date();
      const weeks = Array.from(new Set(chosen.days.map((d) => d.weekNumber))).sort((a, b) => a - b);
      body = (
        <div className="space-y-3">
          <Link href={`${viewBase}?tab=home`} className="font-body text-xs text-rust underline underline-offset-2">
            Back to Home
          </Link>
          <p className="font-display font-bold text-xl uppercase leading-tight">{chosen.program.label ?? chosen.program.name}</p>
          {chosen.days.length === 0 ? (
            <Empty>{EMPTY.noWorkouts}</Empty>
          ) : (
            weeks.map((w) => (
              <div key={w} className="border border-steel/20">
                <p className="px-3 py-2 font-body text-xs text-steel uppercase tracking-wide border-b border-steel/15">Week {w}</p>
                <ul className="divide-y divide-steel/15">
                  {chosen.days
                    .filter((d) => d.weekNumber === w)
                    .map((d) => {
                      const status = dayStatus(d, today, chosen.program.visibilityWindow);
                      return (
                        <li key={d.id} className="px-3 py-2 flex items-center justify-between gap-2">
                          <span className="font-body text-sm truncate">{d.title}</span>
                          <span className={`font-body text-xs shrink-0 ${status === "done" ? "text-moss" : status === "available" ? "text-rust" : "text-steel"}`}>
                            {status === "done" ? "Done" : status === "available" ? "Available" : d.date ? `Unlocks ${formatShortDate(d.date)}` : "Locked"}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))
          )}
        </div>
      );
    } else if (!home) {
      body = <Empty>{EMPTY.loadFailed}</Empty>;
    } else {
      const cards = home.todays.cards;
      body = (
        <div className="space-y-4">
          <div>
            <p className="font-display font-bold text-2xl uppercase leading-none">Hi, {first}</p>
            <p className="font-body text-xs text-steel mt-1">
              {home.doneThisWeek} {home.doneThisWeek === 1 ? "workout" : "workouts"} done this week
            </p>
          </div>
          <div>
            <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Today</p>
            {home.todays.overrideWorkoutId ? (
              <Empty>A workout was assigned for today.</Empty>
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
              <Empty>
                {home.todays.fallback.status === "locked"
                  ? `Next workout unlocks ${formatShortDate(home.todays.fallback.unlocksOn)}.`
                  : home.todays.fallback.status === "no-program"
                    ? EMPTY.noProgram
                    : "Nothing scheduled today."}
              </Empty>
            )}
          </div>
          <div>
            <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Your program</p>
            {!programs || programs.length === 0 ? (
              <Empty>{EMPTY.noProgram}</Empty>
            ) : (
              <ul className="space-y-2">
                {programs.map(({ program, days }) => {
                  const progress = programProgress(days);
                  return (
                    <li key={program.id}>
                      <Link href={`${viewBase}?tab=home&program=${program.id}`} className="block border border-steel/20 p-3 hover:border-rust/60">
                        <p className="font-display font-bold text-base uppercase leading-tight">{program.label ?? program.name}</p>
                        <p className="font-body text-xs text-steel mt-1">{progressLine(progress)}</p>
                        {progress.next && (
                          <p className="font-body text-xs text-chalk mt-1">
                            Next: {progress.next.title}
                            {progress.next.date ? ` · ${formatShortDate(progress.next.date)}` : ""}
                          </p>
                        )}
                        <p className="font-body text-xs text-rust mt-2">See the whole program &rarr;</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      );
    }
  } else if (tab === "history") {
    const logs = await safely(() => loadHistory(supabase, params.groupId, params.athleteId));
    body =
      logs === null ? (
        <Empty>{EMPTY.loadFailed}</Empty>
      ) : logs.length === 0 ? (
        <Empty>{EMPTY.noWorkouts}</Empty>
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
  } else if (tab === "nutrition") {
    const n = await safely(() => loadNutrition(supabase, params.groupId, params.athleteId));
    if (n === null) {
      body = <Empty>{EMPTY.loadFailed}</Empty>;
    } else if (!n.hasAnything) {
      body = <Empty>{EMPTY.noNutrition}</Empty>;
    } else {
      const g = (v: number | null | undefined) => (v == null ? "-" : Math.round(v).toLocaleString("en-US"));
      body = (
        <div className="space-y-4">
          <div>
            <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Today&apos;s targets</p>
            {n.target ? (
              <div className="grid grid-cols-4 gap-2 text-center">
                {(
                  [
                    ["Calories", n.target.calories, n.totals.calories],
                    ["Protein g", n.target.proteinG, n.totals.proteinG],
                    ["Carbs g", n.target.carbsG, n.totals.carbsG],
                    ["Fat g", n.target.fatG, n.totals.fatG],
                  ] as [string, number | null, number][]
                ).map(([label, target, eaten]) => (
                  <div key={label} className="border border-steel/20 p-2">
                    <p className="font-display text-lg leading-none">{g(target)}</p>
                    <p className="font-body text-[10px] text-steel mt-1">{label}</p>
                    <p className="font-body text-[10px] text-chalk mt-1">{g(eaten)} logged</p>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No targets set yet</Empty>
            )}
          </div>
          <div>
            <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Logged today</p>
            {n.entries.length === 0 ? (
              <Empty>Nothing logged today</Empty>
            ) : (
              <ul className="divide-y divide-steel/15 border border-steel/20">
                {n.entries.map((e) => (
                  <li key={e.id} className="px-3 py-2 flex items-center justify-between gap-2">
                    <span className="font-body text-sm truncate">{e.description ?? "Food"}</span>
                    <span className="font-body text-xs text-steel shrink-0">{e.calories != null ? `${Math.round(e.calories)} cal` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {n.recent.length > 0 && (
            <div>
              <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Recent days</p>
              <ul className="divide-y divide-steel/15 border border-steel/20">
                {n.recent.map((r) => (
                  <li key={r.date} className="px-3 py-2 flex items-center justify-between gap-2">
                    <span className="font-body text-sm">{when(`${r.date}T12:00:00`)}</span>
                    <span className="font-body text-xs text-steel">{Math.round(r.calories).toLocaleString("en-US")} cal</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }
  } else {
    const items = await safely(() => loadCalendar(supabase, params.groupId, params.athleteId));
    body =
      items === null ? (
        <Empty>{EMPTY.loadFailed}</Empty>
      ) : items.length === 0 ? (
        <Empty>{EMPTY.noSchedule}</Empty>
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
                href={`${viewBase}?tab=${t.key}`}
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
