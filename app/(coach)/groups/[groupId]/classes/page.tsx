import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { ClassesList, type ClassCard } from "@/components/athlete/classes-list";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { getGroupCoachTimezone } from "@/lib/timezone";

// A client's Group sessions page: the coach's small-group sessions, spots left, one tap to join. Needs migration 0263.
export default async function ClassesPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
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
  if (!membership) redirect("/");

  const timezone = await getGroupCoachTimezone(supabase, params.groupId);
  const nowIso = new Date().toISOString();

  // Row security already limits these to this person's own coach.
  const sessionsResult = await supabase
    .from("group_sessions")
    .select("id, title, start_at, end_at, capacity, location_note, status")
    .eq("kind", "class")
    .gte("start_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(60);
  const notReady = !!sessionsResult.error;
  const sessions = (sessionsResult.data ?? []) as any[];
  const ids = sessions.map((s) => s.id as string);

  const [countsResult, mineResult, creditsResult] = await Promise.all([
    ids.length > 0 ? supabase.rpc("group_session_counts", { p_session_ids: ids }) : Promise.resolve({ data: [] as any[] }),
    ids.length > 0
      ? supabase.from("group_session_attendees").select("group_session_id, status").eq("athlete_id", user.id).in("group_session_id", ids)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("session_credits").select("balance").eq("athlete_id", user.id).eq("group_id", params.groupId).maybeSingle(),
  ]);

  const counts = new Map<string, { joined: number; waitlisted: number }>();
  for (const c of (countsResult.data ?? []) as any[]) counts.set(c.session_id, { joined: c.joined, waitlisted: c.waitlisted });
  const mine = new Map<string, string>();
  for (const m of (mineResult.data ?? []) as any[]) mine.set(m.group_session_id, m.status);

  const classes: ClassCard[] = sessions
    .filter((s) => s.status === "scheduled" || mine.has(s.id))
    .map((s) => ({
      id: s.id,
      title: s.title,
      startIso: s.start_at,
      endIso: s.end_at,
      capacity: s.capacity,
      joined: counts.get(s.id)?.joined ?? 0,
      waitlisted: counts.get(s.id)?.waitlisted ?? 0,
      locationNote: s.location_note ?? null,
      mine: (["joined", "waitlisted", "attended", "cancelled"].includes(mine.get(s.id) ?? "") ? mine.get(s.id) : null) as ClassCard["mine"],
      cancelled: s.status === "cancelled",
    }));

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <div className="px-5 pt-8 max-w-xl mx-auto">
        <Link href={`/groups/${params.groupId}`} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Home
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">Group sessions</h1>
        <p className="font-body text-sm text-steel mt-2">Small-group sessions with your coach. Tap to join.</p>
        <div className="mt-6">
          {notReady ? (
            <p className="font-body text-sm text-steel">Group sessions aren&apos;t switched on yet.</p>
          ) : (
            <ClassesList classes={classes} balance={creditsResult.data?.balance ?? null} timezone={timezone} nowIso={nowIso} />
          )}
        </div>
      </div>
      <BottomTabBar groupId={params.groupId} activeOverride="home" />
    </main>
  );
}
