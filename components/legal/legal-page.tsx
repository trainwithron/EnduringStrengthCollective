import Link from "next/link";
import { DRAFT_BANNER, supportEmail } from "@/lib/legal";

// One layout for /beta, /terms, /privacy and /refunds, so each is plainly marked as a draft and each shows where to
// write to us.
export function LegalPage({
  title,
  version,
  children,
}: {
  title: string;
  version: string;
  children: React.ReactNode;
}) {
  const email = supportEmail();
  return (
    <main className="min-h-screen bg-graphite text-chalk px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Back
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-4">{title}</h1>
        <p className="font-body text-xs text-steel mt-2">Version {version}</p>

        <p className="font-body text-sm text-chalk border border-rust/40 bg-rust/5 p-3 mt-6">{DRAFT_BANNER}</p>

        <div className="mt-6 space-y-5 font-body text-[15px] leading-relaxed">{children}</div>

        <p className="font-body text-sm text-steel mt-10 pt-6 border-t border-steel/20">
          Questions or problems:{" "}
          {email ? (
            <a href={`mailto:${email}`} className="text-rust underline underline-offset-2">
              {email}
            </a>
          ) : (
            <span>a contact address is being added.</span>
          )}
        </p>
        <p className="font-body text-xs text-steel mt-4 flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/beta">Beta notice</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/refunds">Refunds</Link>
        </p>
      </div>
    </main>
  );
}
