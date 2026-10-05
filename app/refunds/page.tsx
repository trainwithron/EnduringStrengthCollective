import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL_TITLES, LEGAL_VERSIONS, PLACEHOLDER_SECTIONS } from "@/lib/legal";

export const metadata = { title: "Refunds and cancellations" };

export default function Page() {
  return (
    <LegalPage title={LEGAL_TITLES.refunds} version={LEGAL_VERSIONS.refunds}>
      {PLACEHOLDER_SECTIONS.refunds.map((s) => (
        <section key={s.heading}>
          <h2 className="font-display uppercase text-lg tracking-wide">{s.heading}</h2>
          <p className="mt-1 text-steel">{s.body}</p>
        </section>
      ))}
    </LegalPage>
  );
}
