"use client";

import { useState } from "react";
import { InbodyScansSection } from "@/components/body/inbody-scans-section";

// On the client's My progress (CL1, Nov 21) and the coach's Progress tab: one quiet line that opens their InBody scans (add one from a photo with "Scan an InBody sheet", see the graphs).
// (Home's InBody tile and its pop-up are gone: Log food took the tile's place, CL10 Nov 21.)
export function InbodyEntry({ athleteId, groupId }: { athleteId: string; groupId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div id="inbody" className="mt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-h-11 font-body text-xs text-rust-ink underline underline-offset-2">
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
