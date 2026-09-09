"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";
import type { FeedChannel } from "@/lib/types";

const CHANNEL_LABELS: Record<FeedChannel, string> = {
  announcements: "Announcements",
  form_checks: "Form Checks",
  pr_board: "PR Board",
  general: "General",
};

// Org owner/admin only — a real, irreversible wipe of every post (and,
// via cascade, every comment) in the currently-open channel. Deliberately
// scoped to one channel at a time rather than "delete everything across
// every channel in one click" — clearing General shouldn't also silently
// erase Announcements or the PR Board.
export function ClearChannelButton({ groupId, channel }: { groupId: string; channel: FeedChannel }) {
  const router = useRouter();
  const [canClear, setCanClear] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // A real per-group coach can already clear via the RLS grant below
      // regardless of org role.
      const { data: coachMembership } = await supabase
        .from("group_memberships")
        .select("role")
        .eq("group_id", groupId)
        .eq("profile_id", user.id)
        .maybeSingle();
      if (coachMembership?.role === "coach") {
        if (!cancelled) setCanClear(true);
        return;
      }

      // Owner/admin of the specific organization that owns *this* group —
      // not "owner/admin of any organization," which would have shown the
      // button to someone with no real authority over this group at all.
      const { data: group } = await supabase
        .from("groups")
        .select("organization_id")
        .eq("id", groupId)
        .maybeSingle();
      if (!group?.organization_id) return;

      const { data: orgMembership } = await supabase
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", group.organization_id)
        .eq("profile_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setCanClear(orgMembership?.role === "owner" || orgMembership?.role === "admin");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  async function handleClear() {
    setClearing(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase
      .from("posts")
      .delete()
      .eq("group_id", groupId)
      .eq("channel", channel);
    setClearing(false);
    if (deleteError) {
      setError("Couldn't clear the channel — try again.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  if (!canClear) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Clear ${CHANNEL_LABELS[channel]}`}
        title={`Clear ${CHANNEL_LABELS[channel]}`}
        className="w-8 h-8 flex items-center justify-center text-steel active:text-rust transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {confirming && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-surface border border-steel/30 z-30 shadow-lg p-3">
          <p className="font-body text-sm text-chalk">
            Delete every post in <span className="font-medium">{CHANNEL_LABELS[channel]}</span>?
          </p>
          <p className="font-body text-xs text-steel mt-1">
            This can&apos;t be undone — every post and comment in this channel is gone for everyone.
          </p>
          {error && (
            <p className="font-body text-xs text-rust mt-2" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={handleClear}
              disabled={clearing}
              className="h-9 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
            >
              {clearing ? "Clearing…" : "Clear channel"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={clearing}
              className="font-body text-xs text-steel disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
