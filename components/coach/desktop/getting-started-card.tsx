import Link from "next/link";

// Shown on a new coach's Home until they have a first client: the three things that get a coaching business going. Plain
// links, no state; it disappears on its own once there is a client.
export function GettingStartedCard({ groupId }: { groupId: string }) {
  const steps = [
    {
      title: "Add your first client",
      body: "Add them by name (or send a link). You can build their program before they ever sign in.",
      href: `/groups/${groupId}/clients`,
      cta: "Add a client",
    },
    {
      title: "Build your first program",
      body: "Start from scratch or import one, then assign it to a client.",
      href: `/groups/${groupId}/programs/new`,
      cta: "Build a program",
    },
    {
      title: "Set your availability",
      body: "Tell the app when you can train people so booking and your calendar work.",
      href: `/groups/${groupId}/availability`,
      cta: "Set availability",
    },
  ];
  return (
    <section className="border border-steel/25 p-5 mb-6">
      <h2 className="font-display uppercase font-bold text-xl leading-none">Get started</h2>
      <p className="font-body text-sm text-steel mt-2">Three steps and you are coaching.</p>
      <ol className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
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
    </section>
  );
}
