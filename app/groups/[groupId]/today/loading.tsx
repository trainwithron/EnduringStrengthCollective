// /today resolves which workout is due and then redirects — there's no
// content of its own to skeleton, so this says what's actually happening
// instead of flashing a fake page shape the athlete never lands on.
export default function TodayLoading() {
  return (
    <main className="min-h-screen bg-graphite flex items-center justify-center px-6">
      <p className="font-body text-sm text-steel animate-pulse">Finding today&apos;s workout…</p>
    </main>
  );
}
