import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { ClassesList } from "@/components/athlete/classes-list";
import { loadClassCards } from "@/lib/class-cards";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { getGroupCoachTimezone } from "@/lib/timezone";

export const metadata = { title: "Classes" };

// A client's Group sessions page: the coach's small-group sessions, spots left, one tap to join. Needs migration 0263.
export default async function ClassesPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (isReadFailure(membershipError)) return <LoadFailedPage />;

  if (!membership) redirect("/");

  const timezone = await getGroupCoachTimezone(supabase, params.groupId);
  const { classes, balance, notReady, nowIso } = await loadClassCards(supabase, user.id, params.groupId, { limit: 60 });

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
            <ClassesList classes={classes} balance={balance} timezone={timezone} nowIso={nowIso} />
          )}
        </div>
      </div>
      <BottomTabBar groupId={params.groupId} activeOverride="home" />
    </main>
  );
}
