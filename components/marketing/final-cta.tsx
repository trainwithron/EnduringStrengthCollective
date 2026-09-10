import Link from "next/link";

export function FinalCta() {
  return (
    <section className="px-6 py-20 md:py-28 border-t border-steel/20">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="font-display uppercase text-3xl md:text-4xl font-bold">
          Run your program your way
        </h2>
        <p className="font-body text-steel mt-4">
          Set up your organization in minutes — programming, clients, and your
          business dashboard, ready from day one.
        </p>
        <Link
          href="/signup"
          className="inline-block mt-8 h-12 px-8 leading-[48px] bg-rust text-graphite font-display uppercase text-lg font-bold active:bg-rust/80 transition-colors"
        >
          Get started
        </Link>
      </div>
    </section>
  );
}
