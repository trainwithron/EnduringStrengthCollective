"use client";

import { useState } from "react";
import { Settings, X } from "lucide-react";
import { FeedBroadcastSettings } from "@/components/athlete/feed-broadcast-settings";
import { useDialogA11y } from "@/lib/use-dialog-a11y";

type BroadcastLevel = "full" | "prs_only" | "checkin_only" | "private";

export function FeedSettingsButton({
  initialLevel,
  profileId,
}: {
  initialLevel: BroadcastLevel;
  profileId: string;
}) {
  const [open, setOpen] = useState(false);
  // The panel is a full-width bottom sheet (the same pattern as the new-post composer), not a box squeezed into the header row beside the title.
  const dialogRef = useDialogA11y<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Feed settings"
        className="w-11 h-11 flex items-center justify-center text-steel active:text-rust transition-colors"
      >
        <Settings className="w-4 h-4" />
      </button>

      {open && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Feed settings" className="fixed inset-0 bg-graphite z-40 flex items-end">
          <div className="w-full bg-surface p-5 pb-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display uppercase text-lg">Feed settings</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="w-11 h-11 flex items-center justify-center text-steel">
                <X className="w-5 h-5" />
              </button>
            </div>
            <FeedBroadcastSettings initialLevel={initialLevel} profileId={profileId} />
          </div>
        </div>
      )}
    </div>
  );
}
