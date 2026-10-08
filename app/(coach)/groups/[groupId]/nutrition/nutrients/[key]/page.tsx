import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { NutrientDetailView } from "@/components/nutrition/nutrient-detail-view";
import { loadNutrientDetailFacts } from "@/lib/nutrient-detail-facts";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";

// One nutrient in depth: today, the last 7 and 30 days as a percent of the person's reference intake, which foods it came from, and everyday foods that could help (checked against
// their allergies and food rules). Read-only. The same page serves the client (their own data) and their coach (the client picked with ?athleteId=, coach wording). Nothing here is
// sent to the AI.
export default async function NutrientDetailPage(props: { params: Promise<{ groupId: string; key: string }>; searchParams: Promise<{ athleteId?: string }> }) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle();
  if (!membership) notFound();
  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const audience: "coach" | "client" = membership.role === "coach" && !effective.isActingAsOther ? "coach" : "client";

  let athleteId = effective.athleteId;
  let clientName: string | null = null;
  if (audience === "coach") {
    if (!searchParams.athleteId) notFound();
    // The client must be an athlete of THIS group (their own group, for a one-on-one client) that this coach can see.
    const { data: target } = await supabase.from("group_memberships").select("profile_id, profiles ( full_name )").eq("group_id", params.groupId).eq("profile_id", searchParams.athleteId).eq("role", "athlete").maybeSingle();
    if (!target) notFound();
    athleteId = target.profile_id as string;
    clientName = ((target.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null) || "this client";
  }

  const timezone = await getGroupCoachTimezone(supabase, params.groupId);
  const todayKey = dateKeyInZone(timezone);
  const facts = await loadNutrientDetailFacts(supabase, { athleteId, key: params.key, todayKey, audience, clientName });
  if (!facts) notFound();

  const n = facts.detail.nutrient;
  const backHref = audience === "coach" ? `/groups/${params.groupId}/nutrition?athleteId=${athleteId}` : `/groups/${params.groupId}/nutrition`;

  const body = (
    <div className="space-y-6 max-w-[760px]">
      <div>
        <Link href={backHref} className="font-body text-xs text-steel underline underline-offset-2">
          ← Back to Nutrition
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">{n.label}</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">{n.why}</p>
      </div>
      <NutrientDetailView facts={facts} />
    </div>
  );

  if (audience === "coach") {
    const { data: group } = await supabase.from("groups").select("name").eq("id", params.groupId).maybeSingle();
    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="nutrition">
        {body}
      </CoachDesktopShell>
    );
  }

  const actingAsName = effective.isActingAsOther ? ((await supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle()).data?.full_name ?? "Client") : null;
  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      {effective.isActingAsOther && <ActingAsBanner athleteFullName={actingAsName ?? "Client"} groupId={params.groupId} />}
      <div className="px-5 pt-8">{body}</div>
      <BottomTabBar groupId={params.groupId} activeOverride="nutrition" />
    </main>
  );
}
