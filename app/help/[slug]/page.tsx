import Link from "next/link";
import { notFound } from "next/navigation";
import { HelpShell } from "@/components/support/help-shell";
import { HELP_ARTICLES, HELP_BY_SLUG } from "@/lib/help-articles";

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
  const article = HELP_BY_SLUG.get(slug);
  if (!article) notFound();
  return (
    <HelpShell title={article.title} intro={article.summary}>
      <article className="space-y-4 font-body text-[15px] leading-relaxed">
        {article.body.map((p, i) => (
          <p key={i}>{p}</p>
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
