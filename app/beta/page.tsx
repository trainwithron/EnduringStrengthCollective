import { LegalPage } from "@/components/legal/legal-page";
import { betaNoticeParagraphs, LEGAL_TITLES, LEGAL_VERSIONS } from "@/lib/legal";

export const metadata = { title: "Beta notice" };

export default function BetaPage() {
  return (
    <LegalPage title={LEGAL_TITLES.beta_notice} version={LEGAL_VERSIONS.beta_notice}>
      {betaNoticeParagraphs().map((p) => (
        <p key={p}>{p}</p>
      ))}
    </LegalPage>
  );
}
