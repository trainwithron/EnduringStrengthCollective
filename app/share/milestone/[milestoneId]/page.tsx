import type { Metadata } from "next";
import { getSharedMilestone, type SharedMilestone } from "@/lib/shared-milestone";
import { ShareWorkoutButton } from "@/components/share/share-workout-button";

// Milestone Celebrations — the public celebration card for either
// trend-based detector (reverse-diet flagship, recovery-volume
// fast-follow). Deliberately public, no auth check, same model as
// /share/[postId] — but reads exclusively through the service-role
// client scoped to this one exact id (see lib/shared-milestone.ts),
// never an anon RLS grant, since this data is more personal than a
// workout PR. The reverse-diet card never surfaces raw calorie targets
// or the athlete's literal weight — only the relative "expected vs
// actual" framing.

function cardTitle(shared: SharedMilestone): string {
  return shared.milestoneType === "reverse_diet"
    ? `${shared.athleteName}'s metabolism is adapting 🔥`
    : `${shared.athleteName} is training harder AND recovering better 💪`;
}

export async function generateMetadata(
  props: { params: Promise<{ milestoneId: string }> }
): Promise<Metadata> {
  const params = await props.params;
  const shared = await getSharedMilestone(params.milestoneId);
  if (!shared) return { title: "Milestone not found" };

  const title = cardTitle(shared);
  const description = `Training with ${shared.groupName}.`;
  return { title, description, openGraph: { title, description } };
}

export default async function ShareMilestonePage(
  props: { params: Promise<{ milestoneId: string }> }
) {
  const params = await props.params;
  const shared = await getSharedMilestone(params.milestoneId);

  if (!shared) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This milestone card isn&apos;t available.
        </p>
      </main>
    );
  }

  const shareTitle = cardTitle(shared);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm border border-rust/40 bg-surface/40 p-8 text-center">
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust">
          {shared.groupName}
        </p>

        <h1 className="font-display font-bold text-2xl uppercase leading-tight mt-4">
          {shared.milestoneType === "reverse_diet" ? "Metabolism Milestone 🔥" : "Recovery Milestone 💪"}
        </h1>
        <p className="font-body text-lg mt-2">{shared.athleteName}</p>

        {shared.milestoneType === "reverse_diet" ? (
          <div className="mt-8 pb-6 border-b border-steel/20 space-y-3">
            <p className="font-body text-sm">
              Over the last {shared.windowWeeks} weeks, calories went up — deliberately, as part of
              a real reverse diet.
            </p>
            <p className="font-display text-3xl leading-none text-rust">
              ~{shared.weeklyExpectedGainLbs} lb/week
            </p>
            <p className="font-body text-xs text-steel uppercase tracking-wide">
              what a surplus this size would normally cost
            </p>
            <p className="font-body text-sm mt-3">
              Instead, their weight {shared.weightTrendedDown ? "actually trended down" : "held steady"}.
              That&apos;s not luck — that&apos;s a metabolism working harder.
            </p>
          </div>
        ) : (
          <div className="mt-8 pb-6 border-b border-steel/20 space-y-3">
            <p className="font-body text-sm">
              Over the last {shared.windowWeeks} weeks, logged training volume climbed
              {shared.volumeChangePct > 0 ? ` about ${shared.volumeChangePct}%` : ""} — and instead of
              burning out, their own readiness check-ins held steady or improved right alongside it.
            </p>
            <p className="font-display text-3xl leading-none text-rust">
              +{shared.volumeChangePct}% volume
            </p>
            <p className="font-body text-xs text-steel uppercase tracking-wide">
              while recovery held steady
            </p>
            <p className="font-body text-sm mt-3">
              That combination — more work, no worse recovery — is the real sign a program is
              actually working.
            </p>
          </div>
        )}

        <p className="font-body text-xs text-steel mt-4">
          Proof the whole program is working at once.
        </p>

        <div className="mt-6">
          <ShareWorkoutButton path={`/share/milestone/${shared.id}`} title={shareTitle} size="large" />
        </div>

        <p className="font-body text-xs text-steel mt-6 pt-4 border-t border-steel/20">
          Trained with <span className="text-rust">{shared.groupName}</span>
        </p>
      </div>
    </main>
  );
}
