import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 text-center">
      <div>
        <h1 className="font-display uppercase text-4xl font-bold">
          The Enduring Strength Collective
        </h1>
        <p className="font-body text-steel mt-3 max-w-sm mx-auto">
          A training platform for your home team.
        </p>
        <Link
          href="/login"
          className="inline-block mt-6 h-12 px-6 leading-[48px] bg-rust text-graphite font-display uppercase text-lg font-bold active:bg-rust/80 transition-colors"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
