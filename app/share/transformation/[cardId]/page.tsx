import type { Metadata } from "next";
import { getSharedTransformationCard } from "@/lib/shared-transformation-card";
import { ShareWorkoutButton } from "@/components/share/share-workout-button";

// Transformation Cards — the public celebration card. Deliberately
// public, no auth check, same model as every other /share/ page — but
// reads exclusively through the service-role client scoped to this one
// exact id (lib/shared-transformation-card.ts), never an anon RLS grant.
// Never surfaces either absolute weight, only the total change — this
// data is more personal than a workout PR, so the restraint is tighter
// here than anywhere else in the app's sharing surfaces.

export async function generateMetadata(
  props: { params: Promise<{ cardId: string }> }
): Promise<Metadata> {
  const params = await props.params;
  const shared = await getSharedTransformationCard(params.cardId);
  if (!shared) return { title: "Card not found" };

  const title = `${shared.athleteName} is down ${shared.totalLossLbs} lbs 🎉`;
  const description = `Training with ${shared.groupName}.`;
  return { title, description, openGraph: { title, description } };
}

export default async function ShareTransformationCardPage(
  props: { params: Promise<{ cardId: string }> }
) {
  const params = await props.params;
  const shared = await getSharedTransformationCard(params.cardId);

  if (!shared) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">This card isn&apos;t available.</p>
      </main>
    );
  }

  const shareTitle = `${shared.athleteName} is down ${shared.totalLossLbs} lbs 🎉`;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm border border-rust/40 bg-surface/40 p-8 text-center">
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust">
          {shared.groupName}
        </p>

        <h1 className="font-display font-bold text-2xl uppercase leading-tight mt-4">
          Transformation 🎉
        </h1>
        <p className="font-body text-lg mt-2">{shared.athleteName}</p>

        {(shared.beforePhotoUrl || shared.afterPhotoUrl) && (
          <div className="grid grid-cols-2 gap-2 mt-6">
            {shared.beforePhotoUrl && (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shared.beforePhotoUrl}
                  alt="Before"
                  className="w-full aspect-square object-cover"
                />
                <p className="font-body text-[10px] text-steel uppercase tracking-wide mt-1">Before</p>
              </div>
            )}
            {shared.afterPhotoUrl && (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shared.afterPhotoUrl}
                  alt="After"
                  className="w-full aspect-square object-cover"
                />
                <p className="font-body text-[10px] text-steel uppercase tracking-wide mt-1">After</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 pb-6 border-b border-steel/20">
          <p className="font-display text-5xl leading-none text-rust">
            Down {shared.totalLossLbs} lbs
          </p>
          <p className="font-body text-xs text-steel mt-2 uppercase tracking-wide">
            since{" "}
            {new Date(`${shared.windowStartDate}T00:00:00`).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>

          {shared.directComparison && (
            <p className="font-body text-sm text-chalk mt-4">{shared.directComparison.text}</p>
          )}
          {shared.bonusLine && <p className="font-body text-xs text-steel mt-2">{shared.bonusLine}</p>}
        </div>

        <div className="mt-6">
          <ShareWorkoutButton path={`/share/transformation/${shared.id}`} title={shareTitle} size="large" />
        </div>

        <p className="font-body text-xs text-steel mt-6 pt-4 border-t border-steel/20">
          Trained with <span className="text-rust">{shared.groupName}</span>
        </p>
      </div>
    </main>
  );
}
