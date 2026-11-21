"use client";

import { useEffect, useState } from "react";
import { InbodyScansSection } from "@/components/body/inbody-scans-section";
import { InbodyScanFlow, type InbodyStep } from "@/components/body/inbody-scan-flow";
import { HomeSheet, type SheetAsk } from "@/components/athlete/home-sheet";
import type { EscapeAction } from "@/lib/use-dialog-a11y";

// The InBody tile on Home (Ron, Nov 21) opens a pop-up over Home: Take a photo or Upload a photo, then on into the same InBody reading (the outside-AI line, the check
// of every number, Save). It used to only open this line's list and scroll to it.
export const OPEN_INBODY_EVENT = "open-inbody-entry";

// What closing the pop-up does at each step: nothing to lose while choosing; a question first while the numbers are being checked, while it reads (the reading is stopped, nothing
// is saved) and while it saves (it may still finish). Never stuck: a reading that hangs can always be closed.
export function inbodyCloseRule(step: InbodyStep): { action: EscapeAction; ask?: SheetAsk } {
  if (step === "pick") return { action: "close" };
  if (step === "reading") return { action: "ask", ask: { message: "Stop reading this scan? Nothing is saved.", confirmLabel: "Stop", cancelLabel: "Keep reading" } };
  if (step === "saving")
    return { action: "ask", ask: { message: "Close while it saves? It may still finish; check your InBody scans.", confirmLabel: "Close", cancelLabel: "Wait" } };
  return { action: "ask", ask: { message: "Discard this scan? Nothing is saved.", confirmLabel: "Discard", cancelLabel: "Keep checking" } };
}

// On the client's own Home, right under where they log their weight: one quiet line that opens their InBody scans (add one from a photo, see the graphs).
export function InbodyEntry({ athleteId, groupId, initialSheetOpen = false }: { athleteId: string; groupId: string; initialSheetOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(initialSheetOpen);
  // A fresh reading each time the pop-up opens; the list below reloads after a save.
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState(false);
  const [step, setStep] = useState<InbodyStep>("pick");
  const rule = inbodyCloseRule(step);

  useEffect(() => {
    const openIt = () => {
      setStep("pick");
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
        guard={() => rule.action}
        ask={rule.ask}
        returnFocusTo='[data-tile="inbody"]'
      >
        <InbodyScanFlow
          key={round}
          athleteId={athleteId}
          groupId={groupId}
          viewerId={athleteId}
          athleteName="you"
          framed={false}
          onStepChange={setStep}
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
