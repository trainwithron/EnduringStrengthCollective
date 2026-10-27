import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { HelpShell } from "@/components/support/help-shell";
import { HELP_ARTICLES, HELP_BY_SLUG, OLD_HELP_SLUGS } from "@/lib/help-articles";

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const article = HELP_BY_SLUG.get(slug);
  return { title: article ? article.title : "Help" };
}

export default async function HelpArticlePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  // An address from before the 21 articles became 11 lands on the article that holds its answer.
  if (OLD_HELP_SLUGS[slug]) permanentRedirect(`/help/${OLD_HELP_SLUGS[slug]}`);
  const article = HELP_BY_SLUG.get(slug);
  if (!article) notFound();
  return (
    <HelpShell title={article.title} intro={article.summary}>
      <article className="space-y-8 font-body text-[15px] leading-relaxed">
        {article.sections.map((s) => (
          <section key={s.heading} className="space-y-3">
            <h2 className="font-display uppercase text-base tracking-wide">{s.heading}</h2>
            {s.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {s.bullets && (
              <ul className="list-disc pl-5 space-y-2">
                {s.bullets.map((b, i) => (
                  <li key={i}>
                    {b.lead && <strong className="font-bold">{b.lead}</strong>}
                    {b.lead ? " " : ""}
                    {b.text}
                  </li>
                ))}
              </ul>
            )}
            {s.after?.map((p, i) => (
              <p key={`after-${i}`}>{p}</p>
            ))}
          </section>
        ))}
      </article>
      <p className="font-body text-sm mt-8">
        <Link href="/help" className="text-rust underline underline-offset-2">
          All help articles
        </Link>
      </p>
    </HelpShell>
  );
}
