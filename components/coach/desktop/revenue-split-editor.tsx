"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { computeRevenueSplit, formatSplitCents, type CoachShare } from "@/lib/revenue-splits";

const CONNECT_STATUS_LABEL: Record<string, string> = {
  not_connected: "Not connected",
  pending: "Pending",
  enabled: "Active",
  restricted: "Action needed",
};

export function RevenueSplitEditor({
  organizationId,
  groupId,
  currentUserId,
  totalRevenueCents,
  initialPlatformFeePct,
  coaches,
  isOwner,
}: {
  organizationId: string;
  groupId: string;
  currentUserId: string;
  totalRevenueCents: number;
  initialPlatformFeePct: number;
  coaches: (CoachShare & { stripeConnectStatus: string })[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [platformFeePct, setPlatformFeePct] = useState(initialPlatformFeePct.toString());
  const [shares, setShares] = useState<Record<string, string>>(
    Object.fromEntries(coaches.map((c) => [c.profileId, c.revenueSharePct.toString()]))
  );
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function handleConnectStripe() {
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/stripe/connect/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, groupId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start Stripe onboarding.");
      window.location.href = data.url;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Couldn't start Stripe onboarding.");
      setConnecting(false);
    }
  }

  const result = computeRevenueSplit(
    totalRevenueCents,
    parseFloat(platformFeePct) || 0,
    coaches.map((c) => ({ ...c, revenueSharePct: parseFloat(shares[c.profileId]) || 0 }))
  );

  async function persistPlatformFee(value: string) {
    setPlatformFeePct(value);
    if (!isOwner) return;
    const supabase = createBrowserClient();
    await supabase
      .from("organizations")
      .update({ platform_fee_pct: parseFloat(value) || 0 })
      .eq("id", organizationId);
    router.refresh();
  }

  async function persistShare(profileId: string, value: string) {
    setShares((prev) => ({ ...prev, [profileId]: value }));
    if (!isOwner) return;
    const supabase = createBrowserClient();
    await supabase
      .from("organization_memberships")
      .update({ revenue_share_pct: parseFloat(value) || 0 })
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId);
    router.refresh();
  }

  const totalSharePct = coaches.reduce((sum, c) => sum + (parseFloat(shares[c.profileId]) || 0), 0);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="grid grid-cols-3 gap-4">
        <div className="border border-steel/20 p-4">
          <p className="font-display text-2xl leading-none">{formatSplitCents(result.totalRevenueCents)}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Total est. revenue</p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-2xl leading-none">{formatSplitCents(result.platformFeeCents)}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">ESN platform fee</p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-2xl leading-none">{formatSplitCents(result.remainderCents)}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Remainder to split</p>
        </div>
      </div>

      <label className="block max-w-xs">
        <span className="font-body text-xs text-steel uppercase tracking-wide">
          Platform fee (%)
        </span>
        <input
          type="number"
          min={0}
          max={100}
          value={platformFeePct}
          onChange={(e) => persistPlatformFee(e.target.value)}
          disabled={!isOwner}
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1 disabled:opacity-50"
        />
      </label>

      <div>
        <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-2">
          Coach shares (of the remainder)
        </h3>
        <div className="divide-y divide-steel/15">
          {result.coachShares.map((share) => {
            const coach = coaches.find((c) => c.profileId === share.profileId);
            const status = coach?.stripeConnectStatus ?? "not_connected";
            return (
              <div key={share.profileId} className="py-2.5 flex items-center justify-between gap-4">
                <span className="font-body text-sm">
                  {share.fullName}
                  {coach?.role === "owner" && <span className="text-steel"> (owner)</span>}
                </span>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={shares[share.profileId]}
                    onChange={(e) => persistShare(share.profileId, e.target.value)}
                    disabled={!isOwner}
                    className="w-16 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs disabled:opacity-50"
                  />
                  <span className="font-body text-xs text-steel">%</span>
                  <span className="font-body text-sm w-20 text-right">
                    {formatSplitCents(share.amountCents)}
                  </span>
                  {share.profileId === currentUserId ? (
                    status === "enabled" ? (
                      <span className="font-body text-xs text-positive w-28 text-right">Stripe connected</span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleConnectStripe}
                        disabled={connecting}
                        className="font-body text-xs text-rust underline decoration-dotted disabled:opacity-40 w-28 text-right"
                      >
                        {connecting ? "Redirecting…" : "Connect Stripe"}
                      </button>
                    )
                  ) : (
                    <span className="font-body text-xs text-steel w-28 text-right">
                      {CONNECT_STATUS_LABEL[status] ?? status}
                    </span>
                  )}
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
      {connectError && (
        <p className="font-body text-xs text-rust" role="alert">
          {connectError}
        </p>
      )}

      <p className="font-body text-xs text-steel max-w-[65ch]">
        Once a coach&apos;s Stripe connection shows &ldquo;Stripe connected,&rdquo; their share of every
        real payment is transferred to their own Stripe account automatically when it comes in. A coach
        who hasn&apos;t connected yet simply isn&apos;t paid out until they do — nothing blocks the
        payment itself.
      </p>
    </div>
  );
}
