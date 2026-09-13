import { LoadingTip } from "@/components/ui/loading-tip";

// For an athlete this route resolves their active program and redirects to
// its calendar; for a coach it renders the full scheduling grid. Neutral
// copy covers both without promising a shape either one won't match.
export default function CalendarLoading() {
  return (
    <main className="min-h-screen bg-graphite flex flex-col items-center justify-center gap-4 px-6">
      <p className="font-body text-sm text-steel animate-pulse">Loading calendar…</p>
      <div className="max-w-sm text-center">
        <LoadingTip />
      </div>
    </main>
  );
}
