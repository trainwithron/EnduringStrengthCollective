"use client";

import { useEffect, useState } from "react";
import { HomeSheet } from "@/components/athlete/home-sheet";
import { SetMyTargetsCard } from "@/components/athlete/set-my-targets-card";

// Nutrition's "Set my targets" (audit C10, Nov 21): it used to scroll down to the targets card; now it opens the same card in a pop-up, right there, with the first box focused.
export const OPEN_SET_TARGETS_EVENT = "open-set-my-targets";
let sheetOnPage = false;

export function OpenSetTargetsButton({ fallbackHref, className }: { fallbackHref: string; className: string }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={(e) => {
        e.currentTarget.focus();
        if (sheetOnPage) window.dispatchEvent(new Event(OPEN_SET_TARGETS_EVENT));
        else window.location.hash = fallbackHref.replace(/^#/, "");
      }}
      className={className}
      data-set-targets
    >
      Set my targets
    </button>
  );
}

export function SetMyTargetsSheet(props: React.ComponentProps<typeof SetMyTargetsCard> & { initialOpen?: boolean }) {
  const { initialOpen = false, ...card } = props;
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => {
    sheetOnPage = true;
    const openIt = () => setOpen(true);
    window.addEventListener(OPEN_SET_TARGETS_EVENT, openIt);
    return () => {
      sheetOnPage = false;
      window.removeEventListener(OPEN_SET_TARGETS_EVENT, openIt);
    };
  }, []);
  return (
    <HomeSheet open={open} title="Set my targets" onClose={() => setOpen(false)} returnFocusTo="[data-set-targets]" focusFirstField>
      <SetMyTargetsCard {...card} />
    </HomeSheet>
  );
}
