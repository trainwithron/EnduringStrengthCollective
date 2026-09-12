"use client";

import { useEffect, useState } from "react";
import { WellnessCheckinWidget, type WellnessCheckinValues } from "./wellness-checkin-widget";

const DISMISS_KEY_PREFIX = "wellness-popup-dismissed-";
// Real gap a QA pass found: as originally shipped this popup had no
// permanent opt-out at all — every athlete of every coach got a
// mandatory daily modal with no way to turn it off. localStorage (not
// the per-day sessionStorage dismiss below) since this needs to survive
// across days and browser sessions, same persistence layer as
// lib/card-size.ts's own per-browser preference convention.
const NEVER_ASK_KEY = "wellness-popup-never-ask";

function readDismissed(todayDate: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DISMISS_KEY_PREFIX + todayDate) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(todayDate: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DISMISS_KEY_PREFIX + todayDate, "1");
  } catch {
    // Storage unavailable — the popup just won't remember the skip past
    // this page's own lifetime, which is a harmless degrade.
  }
}

function readNeverAsk(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NEVER_ASK_KEY) === "1";
  } catch {
    return false;
  }
}

function writeNeverAsk(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NEVER_ASK_KEY, "1");
  } catch {
    // Not remembered past this session either way — harmless degrade.
  }
}

// Shown once per day, before/over the Day-card, the first time Home
// loads that day — a real nudge (unlike the old scrollable widget it
// replaces) but never a hard block: a visible "Skip for today" always
// dismisses it, and it never reappears again that day once either
// skipped or actually submitted. A separate, smaller "Don't ask me
// again" permanently opts out. See
// [[athlete_home_calendar_redesign]]'s wellness-popup section.
export function WellnessCheckinPopup({
  athleteId,
  groupId,
  todayDate,
  initialCheckin,
  onSaved,
}: {
  athleteId: string;
  groupId: string;
  todayDate: string;
  initialCheckin: WellnessCheckinValues | null;
  onSaved?: (values: WellnessCheckinValues) => void;
}) {
  const [checkin, setCheckin] = useState(initialCheckin);
  const [dismissed, setDismissed] = useState(true); // default hidden until the effect below confirms it's actually needed, so SSR/hydration never briefly flashes the overlay for someone who already checked in or already dismissed it earlier today
  const [neverAsk, setNeverAsk] = useState(true); // same reasoning — defaults hidden until confirmed

  useEffect(() => {
    setDismissed(!!initialCheckin || readDismissed(todayDate));
    setNeverAsk(readNeverAsk());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayDate]);

  if (checkin || dismissed || neverAsk) return null;

  function handleSkip() {
    writeDismissed(todayDate);
    setDismissed(true);
  }

  function handleNeverAsk() {
    writeNeverAsk();
    setNeverAsk(true);
  }

  return (
    <div
      role="dialog"
      aria-label="Wellness check-in"
      className="fixed inset-0 z-40 bg-graphite/95 flex items-center justify-center p-6"
    >
      <div className="w-full max-w-sm">
        <WellnessCheckinWidget
          athleteId={athleteId}
          groupId={groupId}
          todayDate={todayDate}
          initialCheckin={null}
          onSaved={(values) => {
            setCheckin(values);
            onSaved?.(values);
          }}
        />
        <button
          type="button"
          onClick={handleSkip}
          className="w-full text-center font-body text-xs text-steel mt-3"
        >
          Skip for today
        </button>
        <button
          type="button"
          onClick={handleNeverAsk}
          className="w-full text-center font-body text-[11px] text-steel/60 mt-2"
        >
          Don&apos;t ask me again
        </button>
      </div>
    </div>
  );
}
