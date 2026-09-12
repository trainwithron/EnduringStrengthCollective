import type { Metadata } from "next";
import { getJourneyRecap } from "@/lib/journey-recap-data";
import { ShareWorkoutButton } from "@/components/share/share-workout-button";

// Milestone Celebrations, piece D — "your journey so far," an always-
// available Spotify-Wrapped-style recap, not gated on hitting anything
// specific. Deliberately public, no auth check, same model as every
// other /share/ page — reads exclusively through the service-role
// client (lib/journey-recap-data.ts), never an anon RLS grant. Only
// ever shows a weight CHANGE, never either absolute weight, matching
// this thread's established privacy restraint.

export async function generateMetadata(
  props: { params: Promise<{ athleteId: string }> }
): Promise<Metadata> {
  const params = await props.params;
  const recap = await getJourneyRecap(params.athleteId);
  if (!recap) return { title: "Journey not available" };

  const title = `${recap.athleteName}'s journey so far`;
  const description = `${recap.journeyDuration} of training with ${recap.groupName}.`;
  return { title, description, openGraph: { title, description } };
}

export default async function ShareJourneyPage(
  props: { params: Promise<{ athleteId: string }> }
) {
  const params = await props.params;
  const recap = await getJourneyRecap(params.athleteId);

  if (!recap) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This journey recap isn&apos;t available yet.
        </p>
      </main>
    );
  }

  const shareTitle = `${recap.athleteName}'s journey so far`;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm border border-rust/40 bg-surface/40 p-8 text-center">
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust">
          {recap.groupName}
        </p>

        <h1 className="font-display font-bold text-2xl uppercase leading-tight mt-4">
          {recap.journeyDuration} of showing up
        </h1>
        <p className="font-body text-lg mt-2">{recap.athleteName}</p>

        <div className="mt-8 pb-6 border-b border-steel/20 grid grid-cols-2 gap-y-5">
          <div>
            <p className="font-display text-3xl leading-none">{recap.totalWorkoutCount}</p>
            <p className="font-body text-xs text-steel uppercase tracking-wide mt-1">workouts</p>
          </div>
          <div>
            <p className="font-display text-3xl leading-none">{recap.totalVolume.toLocaleString()}</p>
            <p className="font-body text-xs text-steel uppercase tracking-wide mt-1">lbs lifted</p>
          </div>
          <div>
            <p className="font-display text-3xl leading-none">{recap.totalPrCount}</p>
            <p className="font-body text-xs text-steel uppercase tracking-wide mt-1">PRs</p>
          </div>
          <div>
            <p className="font-display text-3xl leading-none">{recap.weekStreak}</p>
            <p className="font-body text-xs text-steel uppercase tracking-wide mt-1">week streak</p>
          </div>
        </div>

        {recap.weightChangeLabel && (
          <p className="font-body text-sm text-rust mt-4">
            Body weight: {recap.weightChangeLabel} since day one
          </p>
        )}

        <div className="mt-6">
          <ShareWorkoutButton path={`/share/journey/${recap.athleteId}`} title={shareTitle} size="large" />
        </div>

        <p className="font-body text-xs text-steel mt-6 pt-4 border-t border-steel/20">
          Trained with <span className="text-rust">{recap.groupName}</span>
        </p>
      </div>
    </main>
  );
}
