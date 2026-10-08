import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { loadStartInputs, parseLastGroupCookie, pickStartGroup } from "@/lib/start-group";
import { Hero } from "@/components/marketing/hero";
import { FeatureGrid } from "@/components/marketing/feature-grid";
import { Differentiation } from "@/components/marketing/differentiation";
import { FinalCta } from "@/components/marketing/final-cta";
import { BetaBanner, WhyIBuiltThis } from "@/components/marketing/founder-note";

// A signed-in user landing on "/" (e.g. opening the installed app, or a
// bookmark) should never see the marketing page — that's only a front
// door for someone who isn't signed in yet. Mirrors app/login/page.tsx's
// own post-sign-in destination logic exactly: a coach on a phone (or the
// installed app) or any athlete goes to their first group's mobile hub;
// a coach at a desktop goes to /dashboard. Someone signed in with no
// group membership yet (e.g. mid-signup) falls through to the marketing
// page, same as a signed-out visitor — nothing else to send them to.
export default async function HomePage(props: { searchParams: Promise<{ source?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const lastGroupId = parseLastGroupCookie((await cookies()).get("last_group")?.value);
    const membership = pickStartGroup(await loadStartInputs(supabase, user.id, lastGroupId));

    if (membership) {
      const wantsMobileHome = membership.role !== "coach" || (await prefersAthleteStyleView());
      redirect(wantsMobileHome ? `/groups/${membership.group_id}` : "/dashboard");
    }
  }

  // Opened from the installed home-screen icon but not signed in: that person wants to sign in, not read the sales page.
  if (!user && searchParams.source === "pwa") redirect("/login");

  return (
    <main className="min-h-screen">
      <BetaBanner />
      <Hero />
      <FeatureGrid />
      <Differentiation />
      <WhyIBuiltThis />
      <FinalCta />
    </main>
  );
}
