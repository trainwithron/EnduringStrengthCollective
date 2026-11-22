"use client";

import { useEffect, useState } from "react";
import { Activity, Smile, Utensils } from "lucide-react";
import { OPEN_WEIGHT_EVENT } from "@/components/athlete/weight-log-widget";
import { OPEN_FOOD_EVENT } from "@/components/athlete/log-food-sheet";

// The three tiles under the Today card on a client's Home (Look Refresh, client step, Ron Nov 20). Each OPENS its thing in a pop-up over Home (Ron, Nov 21: they used to only
// scroll the page): How I Feel opens the daily wellness check-in (even after it was skipped or answered, to change it; CL9, Nov 21: it was "Check in", which is the weekly form's
// name), Log weight opens one number box with the keyboard up, and Log food opens the food search with the keyboard up (CL10, Nov 21: it took the InBody tile's place; InBody is on
// My progress). Log food shows only where Home shows the Nutrition card and the coach has food tracking on. The pop-ups belong to what already owns each save (the check-in card, the
// weight log, the food search); a tile only says "open". The tile takes focus first, so focus comes back to it when the pop-up closes.
export const OPEN_CHECKIN_EVENT = "open-wellness-checkin";

export function openWellnessCheckin(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_CHECKIN_EVENT));
}

// The daily check-in card is on the page (CL1, Nov 21): the How I Feel tile would only open what is already there, so it steps aside while the card shows.
export const WELLNESS_CARD_SHOWN_EVENT = "wellness-card-shown";
let wellnessCardShown = false;
export function setWellnessCardShown(shown: boolean): void {
  if (typeof window === "undefined" || shown === wellnessCardShown) return;
  wellnessCardShown = shown;
  window.dispatchEvent(new Event(WELLNESS_CARD_SHOWN_EVENT));
}

function openFromTile(e: React.MouseEvent<HTMLButtonElement>, event: string): void {
  e.currentTarget.focus();
  window.dispatchEvent(new Event(event));
}

const tile = "flex flex-col items-center justify-center gap-1.5 min-h-[76px] px-2 py-3 rounded-card bg-surface font-body text-[13px] font-medium text-chalk active:bg-surface-2 text-center";

export function TodayTiles({ showCheckin: allowCheckin = true, showFood = false }: { showCheckin?: boolean; showFood?: boolean }) {
  const [cardShown, setCardShown] = useState(false);
  useEffect(() => {
    const read = () => setCardShown(wellnessCardShown);
    read();
    window.addEventListener(WELLNESS_CARD_SHOWN_EVENT, read);
    return () => window.removeEventListener(WELLNESS_CARD_SHOWN_EVENT, read);
  }, []);
  const showCheckin = allowCheckin && !cardShown;
  const count = 1 + (showCheckin ? 1 : 0) + (showFood ? 1 : 0);
  return (
    <nav aria-label="Log for today" className={`grid ${count === 3 ? "grid-cols-3" : count === 2 ? "grid-cols-2" : "grid-cols-1"} gap-2.5`} data-today-tiles>
      {showCheckin && (
        <button type="button" aria-haspopup="dialog" onClick={(e) => openFromTile(e, OPEN_CHECKIN_EVENT)} className={tile} data-tile="checkin">
          <Smile className="w-5 h-5 text-checkin" aria-hidden="true" />
          How I Feel
        </button>
      )}
      <button type="button" aria-haspopup="dialog" onClick={(e) => openFromTile(e, OPEN_WEIGHT_EVENT)} className={tile} data-tile="weight">
        <Activity className="w-5 h-5 text-win" aria-hidden="true" />
        Log weight
      </button>
      {showFood && (
        <button type="button" aria-haspopup="dialog" onClick={(e) => openFromTile(e, OPEN_FOOD_EVENT)} className={tile} data-tile="food">
          <Utensils className="w-5 h-5 text-rust-ink" aria-hidden="true" />
          Log food
        </button>
      )}
    </nav>
  );
}
