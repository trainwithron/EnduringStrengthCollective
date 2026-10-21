"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { ViewAsClientPicker } from "./view-as-client-picker";
import { VIEW_OVERRIDE_COOKIE, writeViewOverride } from "@/lib/pwa";
import { readBrowserCookie } from "@/lib/active-org";
import { isPhoneView } from "@/lib/phone-coach-routes";
import { COACH_PHONE_LANDING } from "@/lib/start-group";
import { ACTING_AS_SELF_COOKIE_NAME } from "@/lib/acting-as-names";
import { CoachSpotHub } from "@/components/coach/mobile/coach-spot-hub";
import { TerminologyProvider } from "@/components/coach/terminology-provider";

// The coach's bar at the top of the client app while they look at a CLIENT (the name is a dropdown that opens the picker to look at any client in the same layout: their real data, and anything logged is
// attributed to them, so it says whose it is at all times). In the coach's OWN space there is no bar (Release 2: the phone opens as the coach's own account, "the only difference will be that I have the spot
// button up top"). The exit ends the visit: on a phone "Back to me" (their own app), at a computer "Back to coach home". The Spot button sits top-centre of every one of these pages, mounted here because every
// client-app page a coach sees comes through here.
export function ActingAsBanner({ athleteFullName, groupId, isSelf = false }: { athleteFullName: string; groupId: string; isSelf?: boolean }) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  // The coach is looking at their own training when the page says so, or when the "acting as myself" setting is on (a readable cookie, set when the coach opens their own training).
  const [self, setSelf] = useState(isSelf);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    try {
      if (document.cookie.split("; ").some((c) => c === `${ACTING_AS_SELF_COOKIE_NAME}=1`)) setSelf(true);
    } catch {
      // the bar then names the person, which is also correct
    }
    setPhone(isPhoneView({ override: readBrowserCookie(VIEW_OVERRIDE_COOKIE), userAgent: navigator.userAgent }));
  }, []);

  async function exit() {
    setExiting(true);
    await fetch("/api/coach/act-as", { method: "DELETE" });
    // Back to the screen size the device would show by itself (the desktop coaching shell at a desktop).
    writeViewOverride(null);
    // A phone goes back to the coach's own app; a computer to the coaching Home.
    router.push(phone ? COACH_PHONE_LANDING : "/dashboard");
    router.refresh();
  }

  return (
    <>
      {/* Their own space on a phone: no bar, only Spotlight (hidden by width, so it never flashes). At a computer the bar stays: it is the way back to the coaching Home. */}
      <div className={`relative z-30 bg-rust text-graphite px-5 py-2.5 items-center justify-between gap-3 ${self ? "hidden lg:flex" : "flex"}`} data-acting-as-bar>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-label={self ? "Viewing yourself. Pick a client to look at instead" : `Viewing ${athleteFullName}. Pick someone else`}
          className="flex items-center gap-1 min-h-11 max-w-[34%] font-body text-xs font-medium"
        >
          <span className="truncate">{self ? "Me" : athleteFullName}</span>
          <ChevronDown className="w-4 h-4 shrink-0" strokeWidth={2.5} />
        </button>
        <button type="button" onClick={exit} disabled={exiting} className="shrink-0 min-h-11 px-3 border border-graphite/60 font-body text-xs font-bold uppercase tracking-wide disabled:opacity-50">
          {exiting ? "Going…" : phone ? "← Back to me" : "← Back to coach home"}
        </button>
      </div>

      {pickerOpen && <ViewAsClientPicker onClose={() => setPickerOpen(false)} />}
      <TerminologyProvider groupId={groupId}>
        <CoachSpotHub groupId={groupId} />
      </TerminologyProvider>
    </>
  );
}
