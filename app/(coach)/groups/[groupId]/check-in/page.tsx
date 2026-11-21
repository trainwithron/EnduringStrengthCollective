import Link from "next/link";
import { redirect } from "next/navigation";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { WeeklyCheckinForm } from "@/components/athlete/weekly-checkin-form";
import { checkinSubline, readSnapshot } from "@/lib/weekly-checkin";
import { checkinCoach, checkinTimezone, currentCheckinWeek, loadCheckinSnapshot, loadOwnCheckin, signedPhotoUrls } from "@/lib/weekly-checkin-server";

export const metadata = { title: "Weekly check-in" };

// The client's weekly check-in (Ron, Nov 20: R2), reachable any time; Home shows a card for it Friday through Monday. The card at the top is filled in from their own logs that week;
// they answer the rest and send it to their coach. Opened again the same week it shows what they sent, to change, until the coach has reviewed it. Always the signed-in client's own:
// a coach looking through a client's app does not send one for them.
export default async function WeeklyCheckinPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle();
  if (isReadFailure(membershipError)) return <LoadFailedPage />;
  if (membership?.role !== "athlete") return <NoAccess>The weekly check-in is for clients to send to their coach.</NoAccess>;

  const timeZone = await checkinTimezone(supabase, user.id, params.groupId);
  const weekStart = currentCheckinWeek(timeZone);
  const [coach, own, liveSnapshot] = await Promise.all([
    checkinCoach(supabase, params.groupId, user.id),
    loadOwnCheckin(supabase, user.id, params.groupId, weekStart),
    loadCheckinSnapshot(supabase, { athleteId: user.id, groupId: params.groupId, weekStart, timeZone }),
  ]);
  const row = own.row;
  const photos = row ? await signedPhotoUrls(supabase, (row.photo_ids ?? []) as string[]) : [];
  // A reviewed check-in shows what was sent then; otherwise the numbers are today's.
  const snapshot = row?.reviewed_at ? readSnapshot(row.auto_snapshot) : liveSnapshot;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-28">
      <header className="px-5 pt-6">
        <Link href={`/groups/${params.groupId}`} className="inline-flex items-center min-h-11 font-body text-sm text-steel">
          &larr; Home
        </Link>
        <h1 className="font-display font-bold text-[28px] leading-tight mt-1">Weekly check-in</h1>
        <p className="font-body text-sm text-steel mt-1">{checkinSubline(weekStart, coach?.name)}</p>
      </header>
      <section className="px-5 pt-5">
        {own.available ? (
          <WeeklyCheckinForm
            groupId={params.groupId}
            athleteId={user.id}
            coachName={coach?.name ?? null}
            snapshot={snapshot}
            initial={row ? { energy: row.energy, eating: row.eating, win: row.win ?? "", hard: row.hard ?? "", photos } : null}
            reviewed={!!row?.reviewed_at}
          />
        ) : (
          <p className="font-body text-sm text-steel">Check-ins aren&apos;t switched on yet. Check back soon.</p>
        )}
      </section>
      <BottomTabBar groupId={params.groupId} activeOverride="home" />
    </main>
  );
}
