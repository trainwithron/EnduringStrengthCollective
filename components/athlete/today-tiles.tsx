"use client";

import { Activity, ClipboardList, Smile } from "lucide-react";
import { OPEN_INBODY_EVENT } from "@/components/body/inbody-entry";
import { OPEN_WEIGHT_EVENT } from "@/components/athlete/weight-log-widget";

// The three tiles under the Today card on a client's Home (Look Refresh, client step, Ron Nov 20). Each OPENS its thing in a pop-up over Home (Ron, Nov 21: they used to only
// scroll the page): Check in opens the wellness check-in (even after it was skipped or answered, to change it), Log weight opens one number box with the keyboard up, and InBody
// opens Take a photo / Upload a photo and goes on into the InBody reading. The pop-ups belong to what already owns each save (the check-in card, the weight log, the InBody line);
// a tile only says "open". The tile takes focus first, so focus comes back to it when the pop-up closes.
export const OPEN_CHECKIN_EVENT = "open-wellness-checkin";

export function openWellnessCheckin(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_CHECKIN_EVENT));
}

function openFromTile(e: React.MouseEvent<HTMLButtonElement>, event: string): void {
  e.currentTarget.focus();
  window.dispatchEvent(new Event(event));
}

const tile = "flex flex-col items-center justify-center gap-1.5 min-h-[76px] px-2 py-3 rounded-card bg-surface font-body text-[13px] font-medium text-chalk active:bg-surface-2 text-center";

export function TodayTiles({ showCheckin = true }: { showCheckin?: boolean }) {
  return (
    <nav aria-label="Log for today" className={`grid ${showCheckin ? "grid-cols-3" : "grid-cols-2"} gap-2.5`} data-today-tiles>
      {showCheckin && (
        <button type="button" aria-haspopup="dialog" onClick={(e) => openFromTile(e, OPEN_CHECKIN_EVENT)} className={tile} data-tile="checkin">
          <Smile className="w-5 h-5 text-checkin" aria-hidden="true" />
          Check in
        </button>
      )}
      <button type="button" aria-haspopup="dialog" onClick={(e) => openFromTile(e, OPEN_WEIGHT_EVENT)} className={tile} data-tile="weight">
        <Activity className="w-5 h-5 text-win" aria-hidden="true" />
        Log weight
      </button>
      <button type="button" aria-haspopup="dialog" onClick={(e) => openFromTile(e, OPEN_INBODY_EVENT)} className={tile} data-tile="inbody">
        <ClipboardList className="w-5 h-5 text-rust-ink" aria-hidden="true" />
        InBody
      </button>
    </nav>
  );
}
