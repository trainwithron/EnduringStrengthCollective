"use client";

import { useEffect, useState } from "react";
import { WellnessCheckinWidget, type WellnessCheckinValues } from "./wellness-checkin-widget";

const DISMISS_KEY_PREFIX = "wellness-popup-dismissed-";
// Deliberately sessionStorage, not localStorage: Ron's own call
// (2026-09-14) — re-prompting on every fresh app open even after a same-
// day skip is the intended behavior here ("I do want them to fill it
// out"), not a bug, even though it means a skip doesn't survive closing
// and reopening the app. Don't "fix" this into localStorage without
// checking with him again first.
const SNOOZE_KEY = "wellness-popup-snooze-until";
const SNOOZE_DAYS = 7;
// Real gap a QA pass found: as originally shipped this popup had no
// opt-out at all — every athlete of every coach got a mandatory daily
// modal with no way to turn it off. A PERMANENT opt-out turned out to be
// the wrong fix, though (2026-09-14) — this feeds an ongoing, coach-
// visible readiness signal (the low-readiness roster flag, trend
// charts), and it's stored client-side only with no admin/coach-facing
// way to reverse it — one impulsive tap would silence that athlete's
// data forever with no way back. A week-long snooze gives real relief
// from nagging without permanently killing the signal.

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

function readSnoozed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const until = window.localStorage.getItem(SNOOZE_KEY);
    return !!until && Date.now() < Number(until);
  } catch {
    return false;
  }
}

function writeSnooze(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // Not remembered past this session either way — harmless degrade.
  }
}

// Shown before/over the Day-card, the first time Home loads that day —
// a real nudge (unlike the old scrollable widget it replaces) but never
// a hard block: a visible "Skip for today" always dismisses it, and it
// never reappears again that day once either skipped or actually
// submitted (skipping doesn't survive closing/reopening the app,
// deliberately — see writeDismissed's comment). A separate, smaller
// "Don't ask for a week" gives real relief without permanently killing
// this athlete's readiness signal for their coach. See
// [[athlete_home_calendar_redesign]]'s wellness-popup section.
export function WellnessCheckinPopup({
  athleteId,
  groupId,
  todayDate,
  initialCheckin,
  onSaved,
  lifeImpactPrompt = null,
}: {
  athleteId: string;
  groupId: string;
  todayDate: string;
  initialCheckin: WellnessCheckinValues | null;
  onSaved?: (values: WellnessCheckinValues) => void;
  lifeImpactPrompt?: string | null;
}) {
  const [checkin, setCheckin] = useState(initialCheckin);
  const [dismissed, setDismissed] = useState(true); // default hidden until the effect below confirms it's actually needed, so SSR/hydration never briefly flashes the overlay for someone who already checked in or already dismissed it earlier today
  const [snoozed, setSnoozed] = useState(true); // same reasoning — defaults hidden until confirmed

  useEffect(() => {
    setDismissed(!!initialCheckin || readDismissed(todayDate));
    setSnoozed(readSnoozed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayDate]);

  if (checkin || dismissed || snoozed) return null;

  function handleSkip() {
    writeDismissed(todayDate);
    setDismissed(true);
  }

  function handleSnooze() {
    writeSnooze();
    setSnoozed(true);
  }

  return (
    <div
      role="dialog"
      aria-label="Wellness check-in"
      className="fixed inset-0 z-40 bg-graphite flex items-center justify-center p-6"
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
          lifeImpactPrompt={lifeImpactPrompt}
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
          onClick={handleSnooze}
          className="w-full text-center font-body text-[11px] text-steel/60 mt-2"
        >
          Don&apos;t ask for a week
        </button>
      </div>
    </div>
  );
}
