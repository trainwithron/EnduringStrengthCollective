"use client";

import { useEffect, useState } from "react";
import { WellnessCheckinWidget, type WellnessCheckinValues } from "./wellness-checkin-widget";
import { OPEN_CHECKIN_EVENT } from "./today-tiles";
import { HomeSheet } from "./home-sheet";

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

// Shown as a card at the top of Home (above the Day-card), the first time Home loads that day. It used to be a full-screen layer, which covered
// the Spotlight button and the tab bar until it was answered or skipped (Oct 24: a coach on their own Home could not open Spotlight): now it is a card
// in the page, never over anything. Never a hard block: a visible "Skip for today" always dismisses it, and it
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

  // The Check in tile on Home opens it on purpose (Look Refresh, Nov 20): then it shows even when it was skipped, snoozed or already answered (to change today's answers).
  // Opening it changes nothing stored: a skip or a snooze stays as it was. Since Nov 21 (Ron) the tile opens it as a pop-up over Home, never by scrolling the page.
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    setDismissed(!!initialCheckin || readDismissed(todayDate));
    setSnoozed(readSnoozed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayDate]);

  useEffect(() => {
    const open = () => setOpened(true);
    window.addEventListener(OPEN_CHECKIN_EVENT, open);
    return () => window.removeEventListener(OPEN_CHECKIN_EVENT, open);
  }, []);

  if (!opened && (checkin || dismissed || snoozed)) return null;

  function handleSkip() {
    writeDismissed(todayDate);
    setDismissed(true);
    setOpened(false);
  }

  function handleSnooze() {
    writeSnooze();
    setSnoozed(true);
    setOpened(false);
  }

  const body = (
    <>
      <WellnessCheckinWidget
        athleteId={athleteId}
        groupId={groupId}
        todayDate={todayDate}
        initialCheckin={checkin}
        onSaved={(values) => {
          setCheckin(values);
          onSaved?.(values);
        }}
        lifeImpactPrompt={lifeImpactPrompt}
      />
      {checkin ? null : (
        <div className="flex flex-wrap justify-center gap-x-6 mt-1">
          <button type="button" onClick={handleSkip} className="h-11 font-body text-sm text-steel">
            Skip for today
          </button>
          <button type="button" onClick={handleSnooze} className="h-11 font-body text-sm text-steel">
            Don&apos;t ask for a week
          </button>
        </div>
      )}
    </>
  );

  // Opened from the tile: the same check-in in a pop-up over Home, with a close button (closing it changes nothing stored). Otherwise the card in the page, as before.
  if (opened) {
    return (
      <HomeSheet open title="Wellness check-in" showTitle={false} onClose={() => setOpened(false)} returnFocusTo='[data-tile="checkin"]'>
        <div data-wellness-card data-checkin-sheet>
          {body}
        </div>
      </HomeSheet>
    );
  }
  return (
    <section id="checkin" className="bg-surface rounded-card p-4" aria-label="Wellness check-in" data-wellness-card>
      {body}
    </section>
  );
}
