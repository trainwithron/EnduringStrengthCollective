import Link from "next/link";

export const metadata = { title: "Page not found" };

// Shown for any URL that doesn't exist, and whenever a page calls notFound().
// Without this Next.js renders its stock white 404, which looks like a
// different product from the rest of the app.
export default function NotFound() {
  return (
    <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <h1 className="font-display font-bold uppercase text-3xl leading-none">We can&apos;t find that page</h1>
        <p className="font-body text-sm text-steel mt-3">
          The link may be old, or you may not have access to it. Head back and pick up from there.
        </p>
        <div className="flex items-center justify-center gap-4 mt-6">
          <Link
            href="/"
            className="inline-flex items-center justify-center h-11 px-6 bg-rust text-graphite font-body text-sm font-medium"
          >
            Go home
          </Link>
          <Link href="/login" className="font-body text-sm text-steel active:text-rust">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
