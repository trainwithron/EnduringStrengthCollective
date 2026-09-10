"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { FeedBroadcastSettings } from "@/components/athlete/feed-broadcast-settings";

type BroadcastLevel = "full" | "prs_only" | "checkin_only" | "private";

export function FeedSettingsButton({
  initialLevel,
  profileId,
}: {
  initialLevel: BroadcastLevel;
  profileId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Feed settings"
        className="w-8 h-8 flex items-center justify-center text-steel active:text-rust transition-colors"
      >
        <Settings className="w-4 h-4" />
      </button>

      {open && (
        <div className="px-5 pt-4 pb-2 border-b border-steel/20 bg-surface/30">
          <FeedBroadcastSettings initialLevel={initialLevel} profileId={profileId} />
        </div>
      )}
    </div>
  );
}
