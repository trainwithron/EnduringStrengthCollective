import { LoadingTip } from "@/components/ui/loading-tip";

// Shown the moment the page is asked for, until it is ready (Ron, Oct 19: pages "missing loading signs").
export default function DashboardLoading() {
  return (
    <main data-loading-fallback className="min-h-screen bg-graphite flex flex-col items-center justify-center gap-4 px-6">
      <p className="font-body text-sm text-steel animate-pulse">Loading home…</p>
      <div className="max-w-sm text-center">
        <LoadingTip />
      </div>
    </main>
  );
}
