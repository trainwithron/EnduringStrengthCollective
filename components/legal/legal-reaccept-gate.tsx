"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LegalAcceptance } from "@/components/legal/legal-acceptance";
import { LEGAL_VERSIONS, type LegalDocument } from "@/lib/legal";
import { gateCopy, legalGateAppliesTo } from "@/lib/legal-status";
import { recordLegalConsentNow } from "@/lib/legal-client";
import { createBrowserClient } from "@/lib/supabase/client";

// Asks a signed-in person to accept the beta notice, terms and privacy policy when they have not accepted the CURRENT versions:
// accounts made before acceptances were recorded, people who joined in a browser other than the one they ticked the box in,
// people who signed in rather than signed up, and everyone when a version is bumped. Checked once per browser tab per version.
// The documents themselves, sign-in pages and public pages are never blocked.
const CHECK_KEY = `legal_checked_${Object.values(LEGAL_VERSIONS).join("_")}`;

export function LegalReacceptGate() {
  const pathname = usePathname();
  const router = useRouter();
  const [needs, setNeeds] = useState<LegalDocument[]>([]);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!legalGateAppliesTo(pathname)) return;
    try {
      if (window.sessionStorage.getItem(CHECK_KEY) === "ok") return;
    } catch {
      // No storage: just check each time.
    }
    let cancelled = false;
    fetch("/api/legal/status", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => ({ needs: [] }));
        const list = (data.needs ?? []) as LegalDocument[];
        if (list.length === 0) {
          try {
            window.sessionStorage.setItem(CHECK_KEY, "ok");
          } catch {
            // ignore
          }
        } else {
          setNeeds(list);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (needs.length === 0 || !legalGateAppliesTo(pathname)) return null;
  const copy = gateCopy(needs);

  async function accept() {
    if (!checked || busy) return;
    setBusy(true);
    setError(null);
    const ok = await recordLegalConsentNow(needs);
    if (!ok) {
      setError("We couldn't save that. Please try again.");
      setBusy(false);
      return;
    }
    try {
      window.sessionStorage.setItem(CHECK_KEY, "ok");
    } catch {
      // ignore
    }
    setNeeds([]);
    setBusy(false);
    router.refresh();
  }

  async function signOut() {
    await createBrowserClient().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="fixed inset-0 z-[100] bg-graphite text-chalk overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="legal-gate-title">
      <div className="min-h-full flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <h1 id="legal-gate-title" className="font-display uppercase text-2xl font-bold">
            {copy.heading}
          </h1>
          <p className="font-body text-sm text-steel mt-2 mb-5">{copy.body}</p>
          <LegalAcceptance checked={checked} onChange={setChecked} id="legal-gate-accept" />
          {error && (
            <p className="font-body text-sm text-rust mt-3" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={accept}
            disabled={!checked || busy}
            className="w-full h-12 mt-5 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40"
          >
            {busy ? "Saving…" : "Accept and continue"}
          </button>
          <button type="button" onClick={signOut} className="mt-4 font-body text-sm text-steel underline">
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
