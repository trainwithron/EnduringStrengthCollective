"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { computeRevenueSplit, formatSplitCents, type CoachShare } from "@/lib/revenue-splits";

export function RevenueSplitEditor({
  organizationId,
  totalRevenueCents,
  coaches,
  isOwner,
}: {
  organizationId: string;
  totalRevenueCents: number;
  coaches: CoachShare[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [shares, setShares] = useState<Record<string, string>>(
    Object.fromEntries(coaches.map((c) => [c.profileId, c.revenueSharePct.toString()]))
  );
  // What is saved for each person, so a refused share can go back to it.
  const [savedShares, setSavedShares] = useState<Record<string, string>>(shares);

  // A display only: this divides the whole monthly figure for the owner to pay out themselves.
  const result = computeRevenueSplit(
    totalRevenueCents,
    0,
    coaches.map((c) => ({ ...c, revenueSharePct: parseFloat(shares[c.profileId]) || 0 }))
  );

  // The most one person's share can be: what the others leave of 100. The box cannot go past it (typing is held at it), so the shares can never add up to more than 100; the database refuses it too.
  function maxShareFor(profileId: string): number {
    const others = coaches.reduce((sum, c) => sum + (c.profileId === profileId ? 0 : parseFloat(shares[c.profileId]) || 0), 0);
    return Math.max(0, Math.round((100 - others) * 100) / 100);
  }

  // Typing only changes what is shown; the share is saved when the box is left.
  function typeShare(profileId: string, value: string) {
    const max = maxShareFor(profileId);
    const n = parseFloat(value);
    const held = value !== "" && Number.isFinite(n) && n > max ? String(max) : value;
    setShares((prev) => ({ ...prev, [profileId]: held }));
  }

  async function persistShare(profileId: string) {
    if (!isOwner) return;
    const value = shares[profileId] ?? "0";
    const next = parseFloat(value) || 0;
    if (value === savedShares[profileId]) return;
    if (next < 0 || next > maxShareFor(profileId)) {
      setShares((prev) => ({ ...prev, [profileId]: savedShares[profileId] }));
      return;
    }
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("organization_memberships")
      .update({ revenue_share_pct: next })
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId);
    if (error) {
      setShares((prev) => ({ ...prev, [profileId]: savedShares[profileId] }));
      return;
    }
    setSavedShares((prev) => ({ ...prev, [profileId]: value }));
    router.refresh();
  }

  const totalSharePct = coaches.reduce((sum, c) => sum + (parseFloat(shares[c.profileId]) || 0), 0);

  return (
    <div className="space-y-6 max-w-2xl @4xl:max-w-4xl">
      <div className="border border-steel/20 p-4 max-w-xs">
        <p className="font-display text-2xl leading-none">{formatSplitCents(result.remainderCents)}</p>
        <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Monthly rates entered, to split</p>
        <p className="font-body text-xs text-steel mt-2">
          Added up from each client&apos;s monthly rate.
        </p>
      </div>

      <div>
        <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-2">
          Coach shares (of the remainder)
        </h3>
        <div className="divide-y divide-steel/15">
          {result.coachShares.map((share) => {
            const coach = coaches.find((c) => c.profileId === share.profileId);
            return (
              <div key={share.profileId} className="py-2.5 flex items-center justify-between gap-4">
                <span className="font-body text-sm">
                  {share.fullName}
                  {coach?.role === "owner" && <span className="text-steel"> (owner)</span>}
                </span>
                <div className="flex items-center gap-3">
                  <input aria-label={`Share for ${share.fullName}`}
                    type="number"
                    min={0}
                    max={maxShareFor(share.profileId)}
                    value={shares[share.profileId]}
                    onChange={(e) => typeShare(share.profileId, e.target.value)}
                    onBlur={() => persistShare(share.profileId)}
                    disabled={!isOwner}
                    className="w-16 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs disabled:opacity-50"
                  />
                  <span className="font-body text-xs text-steel">%</span>
                  <span className="font-body text-sm w-20 text-right">
                    {formatSplitCents(share.amountCents)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {totalSharePct !== 100 && (
          <p className="font-body text-xs text-amber-500 mt-2">
            Coach shares add up to {totalSharePct}%, not 100% —{" "}
            {result.unallocatedCents >= 0
              ? `${formatSplitCents(result.unallocatedCents)} of the remainder is unallocated.`
              : `${formatSplitCents(-result.unallocatedCents)} more than the remainder is allocated.`}
          </p>
        )}
      </div>

      {!isOwner && (
        <p className="font-body text-xs text-steel">Only the organization owner can edit these splits.</p>
      )}
      <p className="font-body text-xs text-steel max-w-[65ch]">
        Spotlight does not pay coaches. Every client payment goes to your organization&apos;s own Stripe
        account. These numbers show what each coach earned, for the owner to pay out themselves.
      </p>
    </div>
  );
}
