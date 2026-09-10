import Link from "next/link";
import { ScreenshotFrame } from "./screenshot-frame";
import { ProgramBuilderPreview } from "./previews";

export function Hero() {
  return (
    <section className="px-6 pt-20 pb-16 md:pt-28 md:pb-24 max-w-6xl mx-auto">
      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div>
          <p className="font-display uppercase tracking-widest text-rust text-sm font-bold mb-4">
            For coaches who run their own program
          </p>
          <h1 className="font-display uppercase text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05]">
            Your training platform.
            <br />
            Built for your team —
            <br />
            not everyone&apos;s.
          </h1>
          <p className="font-body text-steel text-lg mt-6 max-w-md">
            Program building, client management, booking, nutrition, and a
            real business dashboard — one platform, styled the way you
            actually coach.
          </p>
          <div className="flex flex-wrap gap-4 mt-8">
            <Link
              href="/signup"
              className="inline-block h-12 px-8 leading-[48px] bg-rust text-graphite font-display uppercase text-lg font-bold active:bg-rust/80 transition-colors"
            >
              Get started
            </Link>
            <Link
              href="/login"
              className="inline-block h-12 px-8 leading-[48px] border border-steel/40 text-chalk font-display uppercase text-lg font-bold hover:border-chalk transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
        <div className="hidden md:block">
          <ScreenshotFrame variant="desktop">
            <ProgramBuilderPreview />
          </ScreenshotFrame>
        </div>
      </div>
    </section>
  );
}
