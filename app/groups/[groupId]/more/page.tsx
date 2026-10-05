import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { buildMoreSections } from "@/lib/more-links";

// Where you go, as opposed to Settings, which holds what you configure: goals, tools, photos, messages, community.
export default async function MorePage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const athleteId = effective.athleteId;

  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase.from("group_memberships").select("role, history_import_enabled").eq("group_id", params.groupId).eq("profile_id", athleteId).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle(),
  ]);
  if (!membership) redirect("/");

  const sections = buildMoreSections({
    groupId: params.groupId,
    athleteId,
    isCoach: membership.role === "coach",
    historyImportEnabled: !!membership.history_import_enabled,
  });

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      {effective.isActingAsOther && <ActingAsBanner athleteFullName={profile?.full_name ?? "Client"} groupId={params.groupId} />}
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link href={`/groups/${params.groupId}`} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Home
        </Link>
        <h1 className="font-display font-bold text-4xl leading-none mt-3 uppercase">More</h1>
      </header>
      <div className="px-5 pt-6 space-y-8">
        {sections.map((section) => (
          <section key={section.title} aria-labelledby={`more-${section.title}`}>
            <h2 id={`more-${section.title}`} className="font-display uppercase text-xs tracking-wide text-steel mb-2">
              {section.title}
            </h2>
            <ul className="divide-y divide-steel/15 border border-steel/20">
              {section.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block font-body text-sm text-chalk">{l.label}</span>
                      <span className="block font-body text-xs text-steel">{l.hint}</span>
                    </span>
                    <ChevronRight aria-hidden="true" className="w-4 h-4 text-steel shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="font-body text-xs text-steel">
          Looking for notifications, your profile or billing? Those are in{" "}
          <Link href={`/groups/${params.groupId}/settings`} className="underline">
            Settings
          </Link>
          .
        </p>
      </div>
      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
