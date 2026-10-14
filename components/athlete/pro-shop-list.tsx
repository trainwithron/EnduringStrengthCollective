"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import { safeWebUrl } from "@/lib/coach-site";
import { ShopCard, ShopGrid } from "@/components/shared/shop-card";
import type { ProShopLink } from "@/components/coach/desktop/pro-shop-manager";

// The client's Pro Shop: a small storefront. The cards the coach marked Featured come first in their own row, then the rest. Each card opens the coach's link in a new tab (no checkout here).
export function ProShopList({ links }: { links: ProShopLink[] }) {
  function recordClick(l: ProShopLink) {
    // Count the click but never hold up opening the link on it.
    createBrowserClient().rpc("increment_pro_shop_click", { p_id: l.id }).then(() => {});
  }

  const usable = links.filter((l) => safeWebUrl(l.url));
  if (usable.length === 0) {
    return <p className="font-body text-sm text-steel">Your coach hasn&apos;t added anything here yet.</p>;
  }
  const featured = usable.filter((l) => l.featured);
  const rest = usable.filter((l) => !l.featured);

  const card = (l: ProShopLink) => (
    <ShopCard
      key={l.id}
      title={l.title}
      description={l.description}
      imageUrl={safeWebUrl(l.imageUrl)}
      href={safeWebUrl(l.url) as string}
      onOpen={() => recordClick(l)}
      note={
        l.discountDescription ? (
          <>
            {l.discountDescription}
            {l.discountCode && <span className="text-chalk"> &middot; Code: {l.discountCode}</span>}
          </>
        ) : null
      }
    />
  );

  return (
    <div className="space-y-6">
      {featured.length > 0 && (
        <section aria-label="Featured">
          {rest.length > 0 && <h2 className="font-body text-xs uppercase tracking-wide text-steel mb-2">Featured</h2>}
          <ShopGrid>{featured.map(card)}</ShopGrid>
        </section>
      )}
      {rest.length > 0 && (
        <section aria-label={featured.length > 0 ? "More" : "Shop"}>
          {featured.length > 0 && <h2 className="font-body text-xs uppercase tracking-wide text-steel mb-2">More</h2>}
          <ShopGrid>{rest.map(card)}</ShopGrid>
        </section>
      )}
    </div>
  );
}

// The client's Home: the cards the coach marked Featured, at most three, under "[Coach]'s Pro Shop" ("Ron's Pro Shop"; plain "Pro Shop" when the coach has no name). Nothing is drawn when there are none. Same card as the Pro Shop page; a tap opens the link in a new tab.
export function FeaturedShopCards({ links, coachName }: { links: ProShopLink[]; coachName?: string | null }) {
  const featured = links.filter((l) => l.featured && safeWebUrl(l.url)).slice(0, 3);
  if (featured.length === 0) return null;
  const first = (coachName ?? "").trim().split(/s+/)[0] ?? "";
  const heading = first ? `${first}'s Pro Shop` : "Pro Shop";
  return (
    <section aria-label={heading}>
      <h2 className="font-body text-xs uppercase tracking-wide text-steel mb-2">{heading}</h2>
      <ShopGrid>
        {featured.map((l) => (
          <ShopCard
            key={l.id}
            title={l.title}
            description={l.description}
            imageUrl={safeWebUrl(l.imageUrl)}
            href={safeWebUrl(l.url) as string}
            onOpen={() => {
              createBrowserClient().rpc("increment_pro_shop_click", { p_id: l.id }).then(() => {});
            }}
            note={
              l.discountDescription ? (
                <>
                  {l.discountDescription}
                  {l.discountCode && <span className="text-chalk"> &middot; Code: {l.discountCode}</span>}
                </>
              ) : null
            }
          />
        ))}
      </ShopGrid>
    </section>
  );
}
