import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL_TITLES, LEGAL_VERSIONS, PLACEHOLDER_SECTIONS } from "@/lib/legal";

export const metadata = { title: "Privacy policy" };

export default function Page() {
  return (
    <LegalPage title={LEGAL_TITLES.privacy} version={LEGAL_VERSIONS.privacy}>
      {PLACEHOLDER_SECTIONS.privacy.map((s) => (
        <section key={s.heading}>
          <h2 className="font-display uppercase text-lg tracking-wide">{s.heading}</h2>
          <p className="mt-1 text-steel">{s.body}</p>
        </section>
      ))}
    </LegalPage>
  );
}
