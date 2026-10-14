"use client";

import { useState } from "react";
import { InbodyScansSection } from "@/components/body/inbody-scans-section";

// On the client's own Home, right under where they log their weight: one quiet line that opens their InBody scans (add one from a photo, see the graphs).
export function InbodyEntry({ athleteId, groupId }: { athleteId: string; groupId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-h-11 font-body text-xs text-rust underline underline-offset-2">
        {open ? "Hide InBody scans" : "InBody scans"}
      </button>
      {open && (
        <div className="mt-2">
          <InbodyScansSection athleteId={athleteId} groupId={groupId} viewerId={athleteId} athleteName="you" />
        </div>
      )}
    </div>
  );
}
