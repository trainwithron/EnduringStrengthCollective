"use client";

import { useEffect, useRef, useState } from "react";
import { InbodyScansSection } from "@/components/body/inbody-scans-section";
import { InbodyScanFlow, type InbodyStep } from "@/components/body/inbody-scan-flow";
import { HomeSheet } from "@/components/athlete/home-sheet";

// The InBody tile on Home (Ron, Nov 21) opens a pop-up over Home: Take a photo or Upload a photo, then on into the same InBody reading (the outside-AI line, the check
// of every number, Save). It used to only open this line's list and scroll to it.
export const OPEN_INBODY_EVENT = "open-inbody-entry";

// On the client's own Home, right under where they log their weight: one quiet line that opens their InBody scans (add one from a photo, see the graphs).
export function InbodyEntry({ athleteId, groupId, initialSheetOpen = false }: { athleteId: string; groupId: string; initialSheetOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(initialSheetOpen);
  // A fresh reading each time the pop-up opens; the list below reloads after a save.
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState(false);
  const step = useRef<InbodyStep>("pick");

  useEffect(() => {
    const openIt = () => {
      step.current = "pick";
      setSaved(false);
      setRound((r) => r + 1);
      setSheetOpen(true);
    };
    window.addEventListener(OPEN_INBODY_EVENT, openIt);
    return () => window.removeEventListener(OPEN_INBODY_EVENT, openIt);
  }, []);

  return (
    <div id="inbody" className="mt-2">
      <div className="flex flex-wrap items-center gap-x-3">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-h-11 font-body text-xs text-rust-ink underline underline-offset-2">
          {open ? "Hide InBody scans" : "InBody scans"}
        </button>
        {saved && (
          <p className="font-body text-xs text-win" role="status">
            Scan saved.
          </p>
        )}
      </div>
      {open && (
        <div className="mt-2">
          <InbodyScansSection key={round} athleteId={athleteId} groupId={groupId} viewerId={athleteId} athleteName="you" />
        </div>
      )}
      <HomeSheet
        open={sheetOpen}
        title="InBody scan"
        wide
        onClose={() => setSheetOpen(false)}
        // nothing to lose while choosing; the numbers being checked are asked about first; reading or saving cannot be stopped halfway
        guard={() => (step.current === "review" ? "ask" : step.current === "pick" ? "close" : "block")}
        returnFocusTo='[data-tile="inbody"]'
      >
        <InbodyScanFlow
          key={round}
          athleteId={athleteId}
          groupId={groupId}
          viewerId={athleteId}
          athleteName="you"
          framed={false}
          onStepChange={(s) => (step.current = s)}
          onClose={() => setSheetOpen(false)}
          onSaved={() => {
            setSheetOpen(false);
            setSaved(true);
            setRound((r) => r + 1);
          }}
        />
      </HomeSheet>
    </div>
  );
}
