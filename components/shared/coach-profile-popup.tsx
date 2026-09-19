"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { ProShopList } from "@/components/athlete/pro-shop-list";
import type { ProShopLink } from "@/components/coach/desktop/pro-shop-manager";
import { initialsOf } from "@/lib/initials";

// coach_identity_bio_social_link_pinning_scoping_sept19.md — makes a
// coach's name/avatar tappable wherever it already renders to a client
// (Messages thread header, Team roster) to open a popup with their bio,
// full profile photo, and social links. Not a new nav destination —
// triggered inline from an existing name display, so this owns its own
// open/closed state rather than being a page.
interface CoachProfileData {
  bio: string | null;
  photoUrl: string | null;
  socialLinks: ProShopLink[];
}

export function CoachProfilePopup({
  coachId,
  coachName,
  children,
}: {
  coachId: string;
  coachName: string;
  // The existing name/avatar element this wraps — rendered as the tap
  // target itself, so callers don't need to restyle anything.
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CoachProfileData | null>(null);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const [{ data: profileRow }, { data: linkRows }] = await Promise.all([
        supabase.from("coach_profiles").select("bio, photo_url").eq("coach_id", coachId).maybeSingle(),
        supabase
          .from("pro_shop_links")
          .select("id, title, category, description, url, image_url, discount_code, discount_description, click_count")
          .eq("coach_id", coachId)
          .eq("category", "social")
          .order("sort_order"),
      ]);
      if (cancelled) return;
      setData({
        bio: profileRow?.bio ?? null,
        photoUrl: profileRow?.photo_url ?? null,
        socialLinks: (linkRows ?? []).map((l) => ({
          id: l.id,
          title: l.title,
          category: l.category,
          description: l.description,
          url: l.url,
          imageUrl: l.image_url,
          discountCode: l.discount_code,
          discountDescription: l.discount_description,
          clickCount: l.click_count,
        })),
      });
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [open, data, coachId]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="contents text-left">
        {children}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-graphite/70 backdrop-blur-sm flex items-center justify-center p-5" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label={`${coachName}'s profile`}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-graphite border border-steel/30 max-h-[80vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between px-5 pt-5">
              <p className="font-body text-[10px] text-steel uppercase tracking-wide">Coach</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-steel active:text-rust">
                <X className="w-5 h-5" strokeWidth={2.5} />
              </button>
            </div>
            <div className="px-5 pt-3 pb-6">
              <div className="flex flex-col items-center text-center mb-4">
                {data?.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.photoUrl} alt="" className="w-28 h-28 rounded-full object-cover border border-steel/30" />
                ) : (
                  <div className="w-28 h-28 rounded-full bg-surface border border-steel/30 flex items-center justify-center">
                    <span className="font-display text-2xl">{initialsOf(coachName)}</span>
                  </div>
                )}
                <h2 className="font-display font-bold text-xl uppercase mt-3">{coachName}</h2>
              </div>

              {!data ? (
                <p className="font-body text-sm text-steel text-center">Loading…</p>
              ) : (
                <>
                  {data.bio && <p className="font-body text-sm text-chalk whitespace-pre-wrap mb-4">{data.bio}</p>}
                  {data.socialLinks.length > 0 && (
                    <div>
                      <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-2">Follow / Connect</p>
                      <ProShopList links={data.socialLinks} />
                    </div>
                  )}
                  {!data.bio && data.socialLinks.length === 0 && (
                    <p className="font-body text-sm text-steel text-center">Nothing added yet.</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
