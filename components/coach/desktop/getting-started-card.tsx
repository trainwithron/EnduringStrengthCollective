import Link from "next/link";
import { MoveInHelpButton } from "@/components/coach/desktop/move-in-help-button";

// Shown on a new coach's Home until they have a first client: the things that get a coaching business going. Plain links, no state; it disappears on its own once there is a client.
// Nov 20 (Ron: "onboarding smoothness is a priority"): a coach moving from another app gets their own step (paste a list or choose their old app's client file, each person a one-on-one client), a way to
// ask a real person for help moving in, and a way to see the app the way their clients will.
export function GettingStartedCard({ groupId }: { groupId: string }) {
  const steps = [
    {
      title: "Add your first client",
      body: "Add them by name (or send a link). You can build their program before they ever sign in.",
      // Opens Add client itself, not just the list (audit, Nov 21).
      href: "/clients?add=1",
      cta: "Add a client",
    },
    {
      title: "Moving from another app?",
      body: "Paste your client list, or choose the client file you exported from TrueCoach, Trainerize or Everfit. Everyone comes in at once.",
      href: "/clients?add=1&import=1",
      cta: "Bring my clients in",
    },
    {
      title: "Build your first program",
      body: "Start from scratch or import one, then assign it to a client.",
      href: `/groups/${groupId}/programs/new?library=1`,
      cta: "Build a program",
    },
    {
      title: "Set your availability",
      body: "Tell the app when you can train people so booking and your calendar work.",
      href: "/calendar?tab=availability",
      cta: "Set availability",
    },
  ];
  return (
    <section className="border border-steel/25 p-5 mb-6" data-getting-started>
      <h2 className="font-display uppercase font-bold text-xl leading-none">Get started</h2>
      <p className="font-body text-sm text-steel mt-2">A few steps and you are coaching.</p>
      <ol className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {steps.map((s) => (
          <li key={s.title} className="border border-steel/20 p-4 flex flex-col">
            <p className="font-body text-sm font-medium text-chalk">{s.title}</p>
            <p className="font-body text-xs text-steel mt-1 flex-1">{s.body}</p>
            <Link
              href={s.href}
              className="mt-3 h-10 flex items-center justify-center border border-steel/40 text-chalk font-body text-sm active:border-rust"
            >
              {s.cta}
            </Link>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-col gap-2">
        <p className="font-body text-xs text-steel" data-try-as-client>
          See it the way your clients will:{" "}
          <Link href="/my-space/home" className="text-chalk underline underline-offset-2">
            open your own client app
          </Link>{" "}
          and log a workout.
        </p>
        <MoveInHelpButton />
      </div>
    </section>
  );
}
