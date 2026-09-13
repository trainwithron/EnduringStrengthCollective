import { LoadingTip } from "@/components/ui/loading-tip";

// /today resolves which workout is due and then redirects — there's no
// content of its own to skeleton, so this says what's actually happening
// instead of flashing a fake page shape the athlete never lands on.
export default function TodayLoading() {
  return (
    <main className="min-h-screen bg-graphite flex flex-col items-center justify-center gap-4 px-6">
      <p className="font-body text-sm text-steel animate-pulse">Finding today&apos;s workout…</p>
      <div className="max-w-sm text-center">
        <LoadingTip />
      </div>
    </main>
  );
}
