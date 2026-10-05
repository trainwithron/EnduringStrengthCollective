import Link from "next/link";

export const metadata = { title: "Link expired" };

// Where a used, expired or unknown claim link lands.
export default function ClaimInvalidPage() {
  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">That link has expired</h1>
        <p className="font-body text-sm text-steel mt-3">
          Sign-in links work once and only for a limited time. Ask your coach to send you a new one — or, if you
          already chose a password, sign in below.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center h-11 px-6 mt-6 bg-rust text-graphite font-body text-sm font-medium"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
