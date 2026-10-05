import { LegalPage } from "@/components/legal/legal-page";
import { BETA_NOTICE_PARAGRAPHS, LEGAL_TITLES, LEGAL_VERSIONS } from "@/lib/legal";

export const metadata = { title: "Beta notice" };

export default function BetaPage() {
  return (
    <LegalPage title={LEGAL_TITLES.beta_notice} version={LEGAL_VERSIONS.beta_notice}>
      {BETA_NOTICE_PARAGRAPHS.map((p) => (
        <p key={p}>{p}</p>
      ))}
    </LegalPage>
  );
}
