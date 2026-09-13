import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { VideoCheckinActionItem } from "@/components/athlete/video-checkin-action-item";
import { getEffectiveAthlete } from "@/lib/acting-as";

// Client-facing view for coach video check-ins (coach_video_checkin_idea
// memory) — the athlete's own real-self page, same pattern as
// progress-photos/messages: viewed as the effective athlete so a coach
// "acting as" a client can confirm what they'll see.
export default async function VideoCheckinsPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const athleteId = effective.athleteId;

  let actingAsFullName: string | null = null;
  if (effective.isActingAsOther) {
    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle();
    actingAsFullName = p?.full_name ?? "Client";
  }

  const { data: checkinRows } = await supabase
    .from("coach_video_checkins")
    .select("id, video_path, ai_summary, coach_notes, created_at")
    .eq("athlete_id", athleteId)
    .eq("group_id", params.groupId)
    .order("created_at", { ascending: false });

  const { data: actionRows } = await supabase
    .from("coach_video_checkin_action_items")
    .select("id, checkin_id, body, completed, sort_order")
    .eq("athlete_id", athleteId)
    .eq("group_id", params.groupId)
    .order("sort_order", { ascending: true });

  const actionsByCheckin = new Map<string, typeof actionRows>();
  for (const row of actionRows ?? []) {
    const list = actionsByCheckin.get(row.checkin_id) ?? [];
    list.push(row);
    actionsByCheckin.set(row.checkin_id, list);
  }

  const checkins = await Promise.all(
    (checkinRows ?? []).map(async (c) => {
      const { data: signed } = await supabase.storage
        .from("coach-video-checkins")
        .createSignedUrl(c.video_path, 3600);
      return {
        id: c.id,
        videoUrl: signed?.signedUrl ?? null,
        summary: c.ai_summary,
        notes: c.coach_notes,
        createdAt: c.created_at,
        actions: actionsByCheckin.get(c.id) ?? [],
      };
    })
  );

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-28">
      {effective.isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link href={`/groups/${params.groupId}`} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Back to group
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">Video Check-ins</h1>
      </header>

      <div className="px-5 pt-6 space-y-6">
        {checkins.length === 0 ? (
          <p className="font-body text-sm text-steel">
            Nothing yet — your coach&apos;s video check-ins will show up here.
          </p>
        ) : (
          checkins.map((c) => (
            <div key={c.id} className="border border-steel/20 p-4 space-y-3">
              <p className="font-body text-[11px] text-steel uppercase tracking-wide">
                {new Date(c.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
              {c.videoUrl && <video src={c.videoUrl} controls className="w-full bg-surface" />}
              {c.summary && <p className="font-body text-sm text-chalk">{c.summary}</p>}
              {c.actions.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-steel/15">
                  {c.actions.map((a) => (
                    <VideoCheckinActionItem key={a.id} id={a.id} body={a.body} initialCompleted={a.completed} />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
