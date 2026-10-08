import { LEGAL_VERSIONS, SIGNUP_DOCUMENTS, type LegalDocument } from "@/lib/legal";

// Which of the documents everyone agrees to (beta notice, terms, privacy) this person has not yet accepted at the CURRENT
// version. Bumping a version in lib/legal.ts is what asks existing users to accept again; someone who never accepted
// anything (an account made before acceptances were recorded, or one that joined in another browser) is asked too.
export function documentsNeedingAcceptance(accepted: { document: string; version: string }[]): LegalDocument[] {
  const have = new Set(accepted.map((a) => `${a.document}@${a.version}`));
  return SIGNUP_DOCUMENTS.filter((d) => !have.has(`${d}@${LEGAL_VERSIONS[d]}`));
}

// What the accept screen says. When what changed is the beta notice, the privacy policy or both (the terms were not touched) it names exactly those; otherwise the general line.
const GATE_NAMES: Partial<Record<LegalDocument, string>> = { beta_notice: "beta notice", privacy: "privacy policy" };
export function gateCopy(needs: LegalDocument[]): { heading: string; body: string } {
  const named = needs.filter((d) => GATE_NAMES[d]);
  if (needs.length > 0 && named.length === needs.length && needs.length <= 2) {
    const many = needs.length > 1;
    const names = needs.map((d) => GATE_NAMES[d]).join(" and ");
    return {
      heading: `The ${names} ${many ? "were" : "was"} updated`,
      body: `Please read and accept ${many ? "them" : "it"} to continue. You will only be asked again if ${many ? "they change" : "it changes"}.`,
    };
  }
  return { heading: "One quick thing", body: "Please read and accept our terms before you continue. You will only be asked again if they change." };
}

// Pages that must stay readable and usable without agreeing first: the documents themselves and the signed-out flows.
const OPEN_PREFIXES = ["/terms", "/privacy", "/beta", "/refunds", "/login", "/signup", "/invite", "/join", "/set-password", "/forgot-password", "/reset-password", "/claim", "/book", "/share", "/pr", "/auth", "/api"];

export function legalGateAppliesTo(pathname: string): boolean {
  if (pathname === "/") return false;
  return !OPEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
