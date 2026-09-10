import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { Hero } from "@/components/marketing/hero";
import { FeatureGrid } from "@/components/marketing/feature-grid";
import { Differentiation } from "@/components/marketing/differentiation";
import { FinalCta } from "@/components/marketing/final-cta";

// A signed-in user landing on "/" (e.g. opening the installed app, or a
// bookmark) should never see the marketing page — that's only a front
// door for someone who isn't signed in yet. Mirrors app/login/page.tsx's
// own post-sign-in destination logic exactly: a coach on a phone (or the
// installed app) or any athlete goes to their first group's mobile hub;
// a coach at a desktop goes to /dashboard. Someone signed in with no
// group membership yet (e.g. mid-signup) falls through to the marketing
// page, same as a signed-out visitor — nothing else to send them to.
export default async function HomePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: membership } = await supabase
      .from("group_memberships")
      .select("group_id, role")
      .eq("profile_id", user.id)
      .limit(1)
      .single();

    if (membership) {
      const wantsMobileHome = membership.role !== "coach" || (await prefersAthleteStyleView());
      redirect(wantsMobileHome ? `/groups/${membership.group_id}` : "/dashboard");
    }
  }

  return (
    <main className="min-h-screen">
      <Hero />
      <FeatureGrid />
      <Differentiation />
      <FinalCta />
    </main>
  );
}
