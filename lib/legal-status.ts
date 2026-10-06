import { LEGAL_VERSIONS, SIGNUP_DOCUMENTS, type LegalDocument } from "@/lib/legal";

// Which of the documents everyone agrees to (beta notice, terms, privacy) this person has not yet accepted at the CURRENT
// version. Bumping a version in lib/legal.ts is what asks existing users to accept again; someone who never accepted
// anything (an account made before acceptances were recorded, or one that joined in another browser) is asked too.
export function documentsNeedingAcceptance(accepted: { document: string; version: string }[]): LegalDocument[] {
  const have = new Set(accepted.map((a) => `${a.document}@${a.version}`));
  return SIGNUP_DOCUMENTS.filter((d) => !have.has(`${d}@${LEGAL_VERSIONS[d]}`));
}

// Pages that must stay readable and usable without agreeing first: the documents themselves and the signed-out flows.
const OPEN_PREFIXES = ["/terms", "/privacy", "/beta", "/refunds", "/login", "/signup", "/invite", "/join", "/set-password", "/forgot-password", "/reset-password", "/claim", "/book", "/share", "/pr", "/auth", "/api"];

export function legalGateAppliesTo(pathname: string): boolean {
  if (pathname === "/") return false;
  return !OPEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
