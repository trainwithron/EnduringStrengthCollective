import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { MarketplaceRankingWeightsForm } from "@/components/admin/marketplace-ranking-weights-form";

export default async function AdminMarketplaceRankingPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_platform_admin) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">You don&apos;t have access to this page.</p>
      </main>
    );
  }

  const { data: weights } = await supabase
    .from("marketplace_ranking_weights")
    .select("distance_weight, goal_fit_weight, outcome_weight, updated_at")
    .eq("id", true)
    .maybeSingle();

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-8 md:px-10">
      <div className="max-w-xl mx-auto">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Marketplace Ranking</h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
            The three-way blend the coach marketplace search uses to rank results: how close a coach is,
            how well their programming fits the client&apos;s stated goal, and — where a reliable outcome
            signal exists (weight loss and endurance-event goals only) — how well their past clients with
            that same goal actually did. Adjusting these is visible and real, not a hidden default.
          </p>
        </div>

        <MarketplaceRankingWeightsForm
          initialDistanceWeight={weights?.distance_weight ?? 0.3}
          initialGoalFitWeight={weights?.goal_fit_weight ?? 0.3}
          initialOutcomeWeight={weights?.outcome_weight ?? 0.4}
          updatedAt={weights?.updated_at ?? null}
        />

        <p className="font-body text-xs text-steel mt-8">
          <Link href="/" className="text-rust">
            ← Back home
          </Link>
        </p>
      </div>
    </main>
  );
}
