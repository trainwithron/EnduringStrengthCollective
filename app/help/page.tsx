import Link from "next/link";
import { HelpShell } from "@/components/support/help-shell";
import { HELP_ARTICLES, HELP_AUDIENCES } from "@/lib/help-articles";

export const metadata = { title: "Help" };

export default function HelpPage() {
  return (
    <HelpShell title="Help" intro="Short answers, in plain words. Pick the one that sounds like you.">
      <div className="space-y-10">
        {HELP_AUDIENCES.map((aud) => (
          <section key={aud.key} aria-labelledby={`help-${aud.key}`}>
            <h2 id={`help-${aud.key}`} className="font-display uppercase text-lg tracking-wide">
              {aud.title}
            </h2>
            <p className="font-body text-xs text-steel mt-1">{aud.blurb}</p>
            <ul className="mt-3 divide-y divide-steel/15 border border-steel/20">
              {HELP_ARTICLES.filter((a) => a.audience === aud.key).map((a) => (
                <li key={a.slug}>
                  <Link href={`/help/${a.slug}`} className="block p-3 font-body hover:bg-surface/60">
                    <span className="text-sm text-chalk">{a.title}</span>
                    <span className="block text-xs text-steel mt-0.5">{a.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </HelpShell>
  );
}
