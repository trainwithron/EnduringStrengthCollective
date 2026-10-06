import Link from "next/link";

// What a page shows when the signed-in person is not allowed to use it (a coach-only page, a group they are not in, an admin page). It always has
// a way out: a Home button, so nobody is left on a dead end with only the browser's back arrow.
export function NoAccess({ children, homeHref = "/" }: { children: React.ReactNode; homeHref?: string }) {
  return (
    <main className="min-h-screen bg-graphite text-chalk flex flex-col items-center justify-center gap-5 px-6">
      <p className="font-body text-steel text-center max-w-[40ch]">{children}</p>
      <Link href={homeHref} className="inline-flex items-center justify-center h-11 px-6 bg-rust text-graphite font-display font-bold uppercase tracking-wide">
        Go to Home
      </Link>
    </main>
  );
}
