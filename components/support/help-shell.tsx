import Link from "next/link";
import { supportEmail } from "@/lib/legal";
import { SUPPORT_PROMISE } from "@/lib/help-articles";

// One layout for the public support pages: the help center, the changelog and the status page. Plain, readable, and the same row of links on every one, ending with how to reach us.
export function HelpShell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  const email = supportEmail();
  return (
    <main className="min-h-screen bg-graphite text-chalk px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <nav aria-label="Support" className="font-body text-xs text-steel uppercase tracking-wide flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/">&larr; Home</Link>
          <Link href="/help">Help</Link>
          <Link href="/changelog">What&apos;s new</Link>
          <Link href="/status">Status</Link>
        </nav>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-5">{title}</h1>
        {intro && <p className="font-body text-sm text-steel mt-3 max-w-[60ch]">{intro}</p>}
        <div className="mt-8">{children}</div>
        <section aria-label="Contact" className="mt-12 pt-6 border-t border-steel/20 font-body text-sm">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel">Still stuck?</h2>
          <p className="mt-2 text-chalk max-w-[60ch]">{SUPPORT_PROMISE}</p>
          <p className="mt-2 text-steel max-w-[60ch]">
            Coaches: open Business, then Support, in the app. Clients: message your coach, who can reach us if they cannot sort it out.
            {email ? (
              <>
                {" "}
                Anyone can write to{" "}
                <a href={`mailto:${email}`} className="text-rust underline underline-offset-2">
                  {email}
                </a>
                .
              </>
            ) : null}
          </p>
        </section>
      </div>
    </main>
  );
}
