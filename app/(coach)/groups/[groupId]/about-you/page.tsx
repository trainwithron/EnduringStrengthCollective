import Link from "next/link";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { AboutYouForm } from "@/components/athlete/about-you-form";
import { readDateOfBirth, rowToBodyProfile } from "@/lib/client-body-profile";

// A client's own inputs for the calculator (height, weight, sex, activity, goal, optional body fat). Client only: a coach edits these in the client's Targets.
export default async function AboutYouPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "athlete") {
    return <NoAccess>This page is for clients. A coach edits these in the client&apos;s Nutrition area.</NoAccess>;
  }

  const [{ data: details }, { data: intake }, { data: weightRow }, { count: goalCount }] = await Promise.all([
    supabase.from("athlete_profile_details").select("*").eq("athlete_id", user.id).maybeSingle(),
    supabase.from("client_intake").select("date_of_birth").eq("athlete_id", user.id).maybeSingle(),
    supabase.from("body_weight_logs").select("weight").eq("athlete_id", user.id).order("logged_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("client_goals").select("id", { count: "exact", head: true }).eq("athlete_id", user.id).eq("group_id", params.groupId),
  ]);
  const profile = rowToBodyProfile(details as Record<string, unknown> | null, intake as Record<string, unknown> | null);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-28">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link href={`/groups/${params.groupId}`} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Back
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">About you</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          A few numbers so your coach can set a starting target that fits you. Skip anything you don&apos;t know; you can come back any time from Settings.
        </p>
      </header>
      <section className="px-5 pt-6 max-w-xl">
        <AboutYouForm
          athleteId={user.id}
          groupId={params.groupId}
          initial={{
            unit: profile.weightUnit,
            heightCm: profile.heightCm,
            sex: profile.sex,
            activity: profile.activity,
            bodyFatPct: profile.bodyFatPct,
            weightLbs: weightRow?.weight != null ? Number(weightRow.weight) : null,
            dateOfBirthKnown: !!readDateOfBirth(profile),
            hasGoal: (goalCount ?? 0) > 0,
          }}
        />
      </section>
      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
