import { LoadFailed } from "@/components/ui/load-failed";

// A whole page standing in for one whose data could not be read ("Couldn't load this. Try again."), so it never shows an empty list as if nothing were there.
export function LoadFailedPage() {
  return (
    <main className="min-h-screen bg-graphite text-chalk font-body p-5">
      <LoadFailed />
    </main>
  );
}
