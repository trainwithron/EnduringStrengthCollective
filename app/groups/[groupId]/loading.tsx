import { SkeletonBlock } from "@/components/ui/skeleton";

// Fallback skeleton for every route under /groups/[groupId] that doesn't
// define its own. Deliberately neutral: this segment contains both the
// athlete's full-width mobile pages and the coach's sidebar desktop shell,
// so it shows a shape that reads correctly in either — a title block and a
// few content rows on the app's own background, no sidebar or tab bar
// assumptions.
export default function GroupLoading() {
  return (
    <main className="min-h-screen bg-graphite px-5 pt-8">
      <SkeletonBlock className="h-8 w-56" />
      <SkeletonBlock className="h-3 w-40 mt-3" />
      <div className="mt-8 space-y-3">
        <SkeletonBlock className="h-20 w-full" />
        <SkeletonBlock className="h-20 w-full" />
        <SkeletonBlock className="h-20 w-full" />
      </div>
    </main>
  );
}
