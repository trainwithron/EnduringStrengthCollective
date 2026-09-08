"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import type { ReferralPartner } from "@/components/coach/desktop/referral-directory-manager";

export function ReferralDirectoryList({ partners }: { partners: ReferralPartner[] }) {
  async function handleBook(p: ReferralPartner) {
    const supabase = createBrowserClient();
    // Fire the click record but don't block opening the link on it.
    supabase.rpc("increment_referral_click", { p_id: p.id }).then(() => {});
    if (p.bookingUrl) {
      window.open(p.bookingUrl, "_blank", "noopener,noreferrer");
    }
  }

  if (partners.length === 0) {
    return <p className="font-body text-sm text-steel">Your coach hasn&apos;t added any referrals yet.</p>;
  }

  return (
    <div className="space-y-3">
      {partners.map((p) => (
        <div key={p.id} className="border border-steel/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-body font-medium text-[15px]">{p.name}</p>
              <p className="font-body text-xs text-steel">{p.specialty}</p>
            </div>
            {p.bookingUrl && (
              <button
                type="button"
                onClick={() => handleBook(p)}
                className="shrink-0 h-9 px-4 bg-rust text-graphite font-body text-xs font-medium"
              >
                Book
              </button>
            )}
          </div>
          {p.description && <p className="font-body text-sm text-steel mt-2">{p.description}</p>}
          {p.discountDescription && (
            <p className="font-body text-xs text-positive mt-2">
              {p.discountDescription}
              {p.discountCode && <span className="text-chalk"> &middot; Code: {p.discountCode}</span>}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
