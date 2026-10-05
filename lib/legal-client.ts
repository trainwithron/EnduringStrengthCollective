import { SIGNUP_DOCUMENTS, type LegalDocument } from "@/lib/legal";

// Browser side of recording agreement. When someone ticks the box before they are signed in (an invite join that waits
// for an email confirmation, say), the choice is remembered on this device and sent to the server on the next page
// where they are signed in. The server records the version, time, address and device.
const KEY = "legal_pending_docs";

export function rememberLegalConsent(documents: LegalDocument[] = SIGNUP_DOCUMENTS): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(documents));
  } catch {
    // Storage unavailable: the next page simply asks again.
  }
}

export async function recordLegalConsentNow(documents: LegalDocument[] = SIGNUP_DOCUMENTS): Promise<boolean> {
  try {
    const res = await fetch("/api/legal/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Sends any remembered consent. Safe to call on every signed-in page: it does nothing when there is nothing pending.
export async function flushLegalConsent(): Promise<void> {
  let docs: LegalDocument[] | null = null;
  try {
    const raw = window.localStorage.getItem(KEY);
    docs = raw ? (JSON.parse(raw) as LegalDocument[]) : null;
  } catch {
    docs = null;
  }
  if (!docs || docs.length === 0) return;
  if (await recordLegalConsentNow(docs)) {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  }
}
