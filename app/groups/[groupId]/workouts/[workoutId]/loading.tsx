import { SkeletonBlock, SkeletonText, SkeletonPageHeader } from "@/components/ui/skeleton";

// The heaviest athlete page (template + overrides + media + progression
// goals + last-time lookups), and the one opened most often — so it's the
// one where painting something immediately matters most.
export default function WorkoutOverviewLoading() {
  return (
    <main className="min-h-screen bg-graphite pb-32">
      <SkeletonPageHeader />

      <div className="px-5 pt-6 space-y-6">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <SkeletonText width="w-40" className="h-4" />
            <SkeletonText width="w-24" className="mt-2 h-2.5" />
            <div className="mt-3 space-y-2">
              <SkeletonBlock className="h-10 w-full" />
              <SkeletonBlock className="h-10 w-full" />
              <SkeletonBlock className="h-10 w-full" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
