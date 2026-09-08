import { SkeletonBlock, SkeletonText, SkeletonPageHeader } from "@/components/ui/skeleton";

// Opened mid-workout, often on gym wifi/cellular — the one place where a
// frozen screen is most likely to make someone tap twice.
export default function SessionLoading() {
  return (
    <main className="min-h-screen bg-graphite pb-32">
      <SkeletonPageHeader />

      <div className="px-5 pt-4 space-y-6">
        {[0, 1].map((i) => (
          <div key={i}>
            <SkeletonText width="w-36" className="h-4" />
            <div className="mt-3 space-y-2">
              <SkeletonBlock className="h-11 w-full" />
              <SkeletonBlock className="h-11 w-full" />
              <SkeletonBlock className="h-11 w-full" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
