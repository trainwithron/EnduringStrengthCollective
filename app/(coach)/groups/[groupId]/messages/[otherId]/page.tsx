import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { DirectMessageThread } from "@/components/messages/direct-message-thread";
import { CoachProfilePopup } from "@/components/shared/coach-profile-popup";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { loadDirectThread } from "@/lib/direct-thread";

export default async function MessageThreadPage(
  props: { params: Promise<{ groupId: string; otherId: string }>; searchParams: Promise<{ draft?: string }> }
) {
  const params = await props.params;
  // A drafted note (the coach's expiry check-in) opens in the box; capped, and only ever shown for the coach to edit.
  const initialDraft = ((await props.searchParams).draft ?? "").slice(0, 600);
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
  const isCoach = membership?.role === "coach";

  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const isActingAsOther = effective.isActingAsOther;
  const showMobileView = isActingAsOther || !isCoach || (await prefersAthleteStyleView());
  // Same viewer-role resolution as the conversation list page — see its
  // own comment for why this can't just be `isCoach`.
  const viewerIsCoach = isCoach && !isActingAsOther;
  const viewerId = viewerIsCoach ? user.id : effective.athleteId;

  // Validate the pairing before rendering anything: a coach can only open
  // a thread with a real athlete member of this group, and vice versa.
  // RLS enforces the actual boundary regardless (a forged otherId simply
  // returns zero message rows below) — this just avoids building a
  // thread header for someone who was never a legitimate party.
  const { data: otherMembership } = await supabase
    .from("group_memberships")
    .select("role, profiles ( full_name )")
    .eq("group_id", params.groupId)
    .eq("profile_id", params.otherId)
    .maybeSingle();

  const expectedOtherRole = viewerIsCoach ? "athlete" : "coach";
  if (!otherMembership || otherMembership.role !== expectedOtherRole) {
    notFound();
  }

  // A coach on a computer has no separate message page: the conversation is the Messages tab of that client's profile, so Back goes back to where they were. This address stays as a
  // redirect for old bell, text and link targets; a drafted note rides along. (On a phone the page below is still used.)
  if (viewerIsCoach && !showMobileView) {
    const draft = initialDraft ? `&draft=${encodeURIComponent(initialDraft)}` : "";
    redirect(`/groups/${params.groupId}/athletes/${params.otherId}?tab=messages${draft}`);
  }

  const otherProfile = otherMembership.profiles as unknown as { full_name: string } | null;
  const otherName = otherProfile?.full_name ?? (viewerIsCoach ? "Athlete" : "Coach");

  const [{ data: viewerProfile }, messages] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", viewerId).maybeSingle(),
    // Opening the thread is the "seen it" moment: what the other person sent is marked read, and so is the bell's line for it (see lib/direct-thread.ts, shared with the
    // Messages tab on a client's profile).
    loadDirectThread(supabase, { groupId: params.groupId, viewerId, otherId: params.otherId }),
  ]);
  const viewerName = viewerProfile?.full_name ?? "You";

  let actingAsFullName: string | null = null;
  if (isActingAsOther) {
    actingAsFullName = viewerName;
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body">
      {isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      <header className="px-5 pt-8 pb-4 border-b border-steel/20">
        <Link
          href={viewerIsCoach ? `/groups/${params.groupId}/messages` : `/groups/${params.groupId}/settings`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          {viewerIsCoach ? "\u2190 All messages" : "\u2190 Back"}
        </Link>
        {viewerIsCoach ? (
          <h1 className="font-display font-bold text-2xl uppercase leading-none mt-2">{otherName}</h1>
        ) : (
          <CoachProfilePopup coachId={params.otherId} coachName={otherName}>
            <h1 className="font-display font-bold text-2xl uppercase leading-none mt-2 underline decoration-dotted underline-offset-4">
              {otherName}
            </h1>
          </CoachProfilePopup>
        )}
      </header>
      <div className="min-h-[50vh]">
        <DirectMessageThread
          groupId={params.groupId}
          viewerId={viewerId}
          viewerName={viewerName}
          otherId={params.otherId}
          otherName={otherName}
          initialMessages={messages}
          initialDraft={viewerIsCoach ? initialDraft : ""}
          fixedComposer
        />
      </div>
      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
