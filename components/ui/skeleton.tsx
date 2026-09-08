// Shared skeleton primitives for route-level loading.tsx files.
//
// Every page in this app is server-rendered on demand (dynamic), so a tab
// tap costs a server round trip plus Supabase queries. Without a Suspense
// boundary, Next holds the *old* screen on screen for that entire time and
// paints nothing — the tap appears to do nothing, which reads as "the app
// is slow" even when the query itself is fast. A loading.tsx turns that
// dead time into an instant response.
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`bg-surface/60 animate-pulse ${className}`} />;
}

export function SkeletonText({
  width = "w-full",
  className = "",
}: {
  width?: string;
  className?: string;
}) {
  return <SkeletonBlock className={`h-3 ${width} ${className}`} />;
}

// Mirrors the athlete page header (back link / big display title) so the
// swap from skeleton to real content doesn't shift the layout.
export function SkeletonPageHeader() {
  return (
    <header className="px-5 pt-8 pb-6 border-b border-steel/20">
      <SkeletonText width="w-24" className="h-2.5" />
      <SkeletonBlock className="h-8 w-52 mt-3" />
    </header>
  );
}
