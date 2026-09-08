import { SkeletonBlock, SkeletonText, SkeletonPageHeader } from "@/components/ui/skeleton";

export default function FeedLoading() {
  return (
    <main className="min-h-screen bg-graphite pb-28">
      <SkeletonPageHeader />

      {/* Channel tab strip */}
      <div className="flex gap-4 px-5 py-3 border-b border-steel/20">
        <SkeletonText width="w-20" />
        <SkeletonText width="w-16" />
        <SkeletonText width="w-14" />
      </div>

      {/* Post cards */}
      <div className="divide-y divide-steel/15">
        {[0, 1, 2].map((i) => (
          <div key={i} className="px-5 py-4">
            <div className="flex items-center gap-3">
              <SkeletonBlock className="w-9 h-9 rounded-full shrink-0" />
              <div className="flex-1">
                <SkeletonText width="w-32" />
                <SkeletonText width="w-20" className="mt-1.5 h-2.5" />
              </div>
            </div>
            <SkeletonBlock className="h-16 w-full mt-3" />
          </div>
        ))}
      </div>
    </main>
  );
}
