import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { DirectMessageThread } from "@/components/messages/direct-message-thread";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { prefersAthleteStyleView } from "@/lib/pwa-server";

export default async function MessageThreadPage(
  props: { params: Promise<{ groupId: string; otherId: string }> }
) {
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

  const otherProfile = otherMembership.profiles as unknown as { full_name: string } | null;
  const otherName = otherProfile?.full_name ?? (viewerIsCoach ? "Athlete" : "Coach");

  const [{ data: viewerProfile }, { data: messages }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", viewerId).maybeSingle(),
    supabase
      .from("direct_messages")
      .select("id, sender_id, body, created_at")
      .eq("group_id", params.groupId)
      .or(
        `and(sender_id.eq.${viewerId},recipient_id.eq.${params.otherId}),and(sender_id.eq.${params.otherId},recipient_id.eq.${viewerId})`
      )
      .order("created_at", { ascending: true }),
  ]);
  const viewerName = viewerProfile?.full_name ?? "You";

  // Opening the thread is the "seen it" moment — mark anything the other
  // party sent as read now.
  await supabase
    .from("direct_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("group_id", params.groupId)
    .eq("recipient_id", viewerId)
    .eq("sender_id", params.otherId)
    .is("read_at", null);

  let actingAsFullName: string | null = null;
  if (isActingAsOther) {
    actingAsFullName = viewerName;
  }

  if (viewerIsCoach && !showMobileView) {
    const { data: group } = await supabase.from("groups").select("name").eq("id", params.groupId).single();
    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="messages">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <Link
            href={`/groups/${params.groupId}/messages`}
            className="font-body text-xs text-steel uppercase tracking-wide"
          >
            &larr; All messages
          </Link>
          <h1 className="font-display font-bold text-3xl uppercase leading-none mt-1">{otherName}</h1>
        </div>
        <div className="max-w-[560px] h-[65vh] border border-steel/20">
          <DirectMessageThread
            groupId={params.groupId}
            viewerId={viewerId}
            viewerName={viewerName}
            otherId={params.otherId}
            otherName={otherName}
            initialMessages={messages ?? []}
          />
        </div>
      </CoachDesktopShell>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body">
      {isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      <header className="px-5 pt-8 pb-4 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}/messages`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; All messages
        </Link>
        <h1 className="font-display font-bold text-2xl uppercase leading-none mt-2">{otherName}</h1>
      </header>
      <div className="min-h-[50vh]">
        <DirectMessageThread
          groupId={params.groupId}
          viewerId={viewerId}
          viewerName={viewerName}
          otherId={params.otherId}
          otherName={otherName}
          initialMessages={messages ?? []}
          fixedComposer
        />
      </div>
      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
