import { LEGAL_VERSIONS, SIGNUP_DOCUMENTS, type LegalDocument } from "@/lib/legal";

// Which of the documents everyone agrees to (beta notice, terms, privacy) this person has not yet accepted at the CURRENT
// version. Bumping a version in lib/legal.ts is what asks existing users to accept again; someone who never accepted
// anything (an account made before acceptances were recorded, or one that joined in another browser) is asked too.
export function documentsNeedingAcceptance(accepted: { document: string; version: string }[]): LegalDocument[] {
  const have = new Set(accepted.map((a) => `${a.document}@${a.version}`));
  return SIGNUP_DOCUMENTS.filter((d) => !have.has(`${d}@${LEGAL_VERSIONS[d]}`));
}

// What the accept screen says. When only the beta notice changed it says exactly that (the terms and privacy policy were not touched); otherwise the general line.
export function gateCopy(needs: LegalDocument[]): { heading: string; body: string } {
  if (needs.length === 1 && needs[0] === "beta_notice") {
    return { heading: "The beta notice was updated", body: "Please read and accept it to continue. You will only be asked again if it changes." };
  }
  return { heading: "One quick thing", body: "Please read and accept our terms before you continue. You will only be asked again if they change." };
}

// Pages that must stay readable and usable without agreeing first: the documents themselves and the signed-out flows.
const OPEN_PREFIXES = ["/terms", "/privacy", "/beta", "/refunds", "/login", "/signup", "/invite", "/join", "/set-password", "/forgot-password", "/reset-password", "/claim", "/book", "/share", "/pr", "/auth", "/api"];

export function legalGateAppliesTo(pathname: string): boolean {
  if (pathname === "/") return false;
  return !OPEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
