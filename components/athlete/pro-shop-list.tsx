"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import type { ProShopLink } from "@/components/coach/desktop/pro-shop-manager";

const CATEGORY_LABELS: Record<string, string> = {
  merch: "Merch",
  supplements: "Supplements",
  coaching: "Coaching",
  website: "Website",
  other: "Link",
};

export function ProShopList({ links }: { links: ProShopLink[] }) {
  async function handleOpen(l: ProShopLink) {
    const supabase = createBrowserClient();
    // Fire the click record but don't block opening the link on it.
    supabase.rpc("increment_pro_shop_click", { p_id: l.id }).then(() => {});
    window.open(l.url, "_blank", "noopener,noreferrer");
  }

  if (links.length === 0) {
    return <p className="font-body text-sm text-steel">Your coach hasn&apos;t added anything here yet.</p>;
  }

  return (
    <div className="space-y-3">
      {links.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => handleOpen(l)}
          className="w-full text-left border border-steel/20 p-4 flex items-start gap-3 active:bg-surface/60"
        >
          {l.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL.
            <img src={l.imageUrl} alt="" className="w-14 h-14 object-cover border border-steel/20 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="font-body font-medium text-[15px]">{l.title}</p>
              <span className="font-body text-[10px] uppercase tracking-wide text-steel shrink-0">
                {CATEGORY_LABELS[l.category] ?? l.category}
              </span>
            </div>
            {l.description && <p className="font-body text-sm text-steel mt-1">{l.description}</p>}
            {l.discountDescription && (
              <p className="font-body text-xs text-positive mt-2">
                {l.discountDescription}
                {l.discountCode && <span className="text-chalk"> &middot; Code: {l.discountCode}</span>}
              </p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
