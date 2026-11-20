"use client";

import { Activity, ClipboardList, Smile } from "lucide-react";
import { OPEN_INBODY_EVENT } from "@/components/body/inbody-entry";

// The three tiles under the Today card on a client's Home (Look Refresh, client step, Ron Nov 20): each opens what was already on Home. Check in opens the
// wellness check-in (even after it was skipped or answered, to change it); Log weight and InBody go to the weight log and the InBody entry further down.
export const OPEN_CHECKIN_EVENT = "open-wellness-checkin";

export function openWellnessCheckin(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_CHECKIN_EVENT));
}

const tile = "flex flex-col items-center justify-center gap-1.5 min-h-[76px] px-2 py-3 rounded-card bg-surface font-body text-[13px] font-medium text-chalk active:bg-surface-2 text-center";

export function TodayTiles({ showCheckin = true }: { showCheckin?: boolean }) {
  return (
    <nav aria-label="Log for today" className={`grid ${showCheckin ? "grid-cols-3" : "grid-cols-2"} gap-2.5`} data-today-tiles>
      {showCheckin && (
        <button type="button" onClick={openWellnessCheckin} className={tile} data-tile="checkin">
          <Smile className="w-5 h-5 text-checkin" aria-hidden="true" />
          Check in
        </button>
      )}
      <a href="#log-weight" className={tile} data-tile="weight">
        <Activity className="w-5 h-5 text-win" aria-hidden="true" />
        Log weight
      </a>
      <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_INBODY_EVENT))} className={tile} data-tile="inbody">
        <ClipboardList className="w-5 h-5 text-rust" aria-hidden="true" />
        InBody
      </button>
    </nav>
  );
}
