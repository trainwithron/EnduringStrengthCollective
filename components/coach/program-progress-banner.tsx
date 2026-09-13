import { getVolumeEquivalence } from "@/lib/volume-equivalence";

// A running "Day N of M — you've moved X lbs" summary on the program
// overview, paired with the same goofy real-world object comparison
// already built for the post-workout share card (lib/volume-equivalence.ts)
// — reused directly rather than a second version of the same joke.
// Seeded by the program's own id so it stays stable across reloads,
// same convention as the share card seeding by post id.
export function ProgramProgressBanner({
  programId,
  dayNumber,
  totalDays,
  totalVolumeLbs,
}: {
  programId: string;
  dayNumber: number;
  totalDays: number;
  totalVolumeLbs: number;
}) {
  const equivalence = getVolumeEquivalence(totalVolumeLbs, programId);

  return (
    <div className="border border-steel/20 bg-surface px-4 py-3 mb-4">
      <p className="font-body text-[11px] text-steel uppercase tracking-wide font-bold">
        Day {dayNumber} of {totalDays}
      </p>
      <p className="font-body text-sm text-chalk mt-1">
        You&apos;ve moved{" "}
        <span className="text-rust font-medium">{Math.round(totalVolumeLbs).toLocaleString()} lbs</span> so far.
      </p>
      {equivalence && <p className="font-body text-xs text-steel mt-1">{equivalence.text}</p>}
    </div>
  );
}
