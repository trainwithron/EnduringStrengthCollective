"use client";

import { useEffect, useRef, useState } from "react";
import { InbodyScansSection } from "@/components/body/inbody-scans-section";

// The InBody tile on Home (Look Refresh, client step) opens this line's scans and brings them into view.
export const OPEN_INBODY_EVENT = "open-inbody-entry";

// On the client's own Home, right under where they log their weight: one quiet line that opens their InBody scans (add one from a photo, see the graphs).
export function InbodyEntry({ athleteId, groupId }: { athleteId: string; groupId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const openIt = () => {
      setOpen(true);
      ref.current?.scrollIntoView({ block: "start" });
    };
    window.addEventListener(OPEN_INBODY_EVENT, openIt);
    return () => window.removeEventListener(OPEN_INBODY_EVENT, openIt);
  }, []);
  return (
    <div ref={ref} id="inbody" className="mt-2 scroll-mt-4">
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
