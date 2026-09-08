// For an athlete this route resolves their active program and redirects to
// its calendar; for a coach it renders the full scheduling grid. Neutral
// copy covers both without promising a shape either one won't match.
export default function CalendarLoading() {
  return (
    <main className="min-h-screen bg-graphite flex items-center justify-center px-6">
      <p className="font-body text-sm text-steel animate-pulse">Loading calendar…</p>
    </main>
  );
}
