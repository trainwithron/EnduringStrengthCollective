import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { canSignProofs } from "@/lib/public-booking-proof";
import { isSendGridConfigured } from "@/lib/sendgrid";
import { findRankedCoaches, type RankedCoachResult } from "@/lib/marketplace-browse";
import type { GoalType } from "@/lib/marketplace-coach-ranking";

// public_marketplace_vision.md's real, buildable-now v1 — a prospect
// searches by ZIP + goal, sees real ranked coaches. Deliberately public
// (createServiceRoleClient, same trust model as /join/[orgSlug] and
// /book/[coachId] — no session exists to read cross-user data against
// otherwise). Server-rendered off real URL search params (not client
// state) so the page is a real, linkable/shareable URL from the start,
// matching the original vision's own "real SEO consideration" note —
// even though full SEO polish (meta tags, sitemap) isn't part of this
// pass.
const GOAL_OPTIONS: { value: GoalType; label: string }[] = [
  { value: "weight_loss", label: "Lose weight" },
  { value: "body_recomp", label: "Body recomposition" },
  { value: "muscle_gain", label: "Build muscle" },
  { value: "bodybuilding", label: "Bodybuilding" },
  { value: "powerbuilding_strongman", label: "Powerlifting / Strongman" },
  { value: "endurance_event", label: "Training for an endurance event" },
  { value: "custom", label: "Something else" },
];

function isGoalType(value: string | undefined): value is GoalType {
  return !!value && GOAL_OPTIONS.some((g) => g.value === value);
}

function scoreLabel(result: RankedCoachResult): string | null {
  if (result.realOutcomeCaseCount === 0) return null;
  return `${result.realOutcomeCaseCount} real client${result.realOutcomeCaseCount === 1 ? "" : "s"} with this goal tracked`;
}

export default async function FindACoachPage(props: {
  searchParams: Promise<{ zip?: string; goal?: string }>;
}) {
  const searchParams = await props.searchParams;
  const zip = searchParams.zip?.trim() || "";
  const goal: GoalType | null = isGoalType(searchParams.goal) ? (searchParams.goal as GoalType) : null;
  const hasSearched = zip.length > 0 || goal !== null;

  let results: RankedCoachResult[] = [];
  if (goal) {
    const supabase = createServiceRoleClient();
    const { data: weightsRow } = await supabase
      .from("marketplace_ranking_weights")
      .select("distance_weight, goal_fit_weight, outcome_weight")
      .eq("id", true)
      .maybeSingle();
    const weights = weightsRow
      ? { distance: weightsRow.distance_weight, goalFit: weightsRow.goal_fit_weight, outcome: weightsRow.outcome_weight }
      : undefined;
    results = await findRankedCoaches(supabase, {
      prospectZip: /^[0-9]{5}$/.test(zip) ? zip : null,
      goalType: goal,
      weights,
    });
  }

  // A coach card links to that coach's booking page when booking is switched on for the coach (the same condition /book/<slug> itself uses).
  const slugByCoach = new Map<string, string>();
  if (results.length > 0 && canSignProofs() && isSendGridConfigured()) {
    const { data: pages } = await createServiceRoleClient()
      .from("coach_booking_pages")
      .select("coach_id, slug")
      .eq("enabled", true)
      .in("coach_id", results.map((r) => r.coachId));
    for (const p of pages ?? []) slugByCoach.set(p.coach_id as string, p.slug as string);
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-10 md:px-10">
      <div className="max-w-2xl mx-auto">
        <div className="pb-6 border-b border-steel/20 mb-8">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Find a Coach</h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
            Tell us your ZIP and your goal — we&apos;ll show you real coaches ranked by fit and, where we
            have it, real client results.
          </p>
        </div>

        <form method="GET" className="flex flex-col sm:flex-row gap-3 mb-10">
          <label className="flex flex-col gap-1 sm:w-40">
            <span className="font-body text-xs text-steel uppercase tracking-wide">ZIP code (optional)</span>
            <input
              type="text"
              name="zip"
              inputMode="numeric"
              maxLength={5}
              defaultValue={zip}
              placeholder="e.g. 89101"
              className="h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 flex-1">
            <span className="font-body text-xs text-steel uppercase tracking-wide">What&apos;s your goal?</span>
            <select
              name="goal"
              defaultValue={goal ?? ""}
              required
              className="h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm"
            >
              <option value="" disabled>
                Choose a goal
              </option>
              {GOAL_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium self-end"
          >
            Search
          </button>
        </form>

        {hasSearched && goal === null && (
          <p className="font-body text-sm text-rust">Pick a goal to see results.</p>
        )}

        {goal && results.length === 0 && (
          <p className="font-body text-sm text-steel">
            No coaches with a real program library match this goal yet — try a different goal, or check
            back soon.
          </p>
        )}

        {goal && results.length > 0 && (
          <div className="space-y-3">
            {results.map((r) => (
              <div key={r.coachId} className="border border-steel/20 p-4 bg-surface/40">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display font-bold text-lg uppercase leading-tight">{r.coachName}</p>
                    {r.orgName && <p className="font-body text-xs text-steel mt-0.5">{r.orgName}</p>}
                  </div>
                  {r.distanceMiles !== null && (
                    <p className="font-body text-xs text-steel shrink-0">{Math.round(r.distanceMiles)} mi away</p>
                  )}
                </div>
                {scoreLabel(r) && (
                  <p className="font-body text-xs text-moss mt-2">{scoreLabel(r)}</p>
                )}
                {slugByCoach.get(r.coachId) && (
                  <Link href={`/book/${slugByCoach.get(r.coachId)}`} className="inline-flex items-center h-11 mt-2 font-body text-sm text-rust underline">
                    Book a time →
                  </Link>
                )}
              </div>
            ))}
            <p className="font-body text-xs text-steel pt-2">
              Ranked by a real blend of distance, program fit, and — where enough real client history
              exists — measured outcomes.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
