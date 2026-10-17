"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { ViewAsClientPicker } from "./view-as-client-picker";
import { writeViewOverride } from "@/lib/pwa";
import { ACTING_AS_SELF_COOKIE_NAME } from "@/lib/acting-as-names";
import { CoachSpotHub } from "@/components/coach/mobile/coach-spot-hub";
import { TerminologyProvider } from "@/components/coach/terminology-provider";

// The coach's bar at the top of the client app. A coach opens the app on their OWN client profile ("Me"); the name here is a dropdown that opens the picker to look at any client in the same layout (their real
// data, and anything logged is attributed to them, so it says whose it is at all times). "Coach home" ends the visit and goes back to the coaching Home. The Spot button (business: clients, calendar, messages,
// programs, Ask Spot) sits top-centre of every one of these pages, mounted here because every client-app page a coach sees carries this bar.
export function ActingAsBanner({ athleteFullName, groupId, isSelf = false }: { athleteFullName: string; groupId: string; isSelf?: boolean }) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  // The coach is looking at their own training when the page says so, or when the "acting as myself" setting is on (a readable cookie, set when the coach opens their own training).
  const [self, setSelf] = useState(isSelf);
  useEffect(() => {
    try {
      if (document.cookie.split("; ").some((c) => c === `${ACTING_AS_SELF_COOKIE_NAME}=1`)) setSelf(true);
    } catch {
      // the bar then names the person, which is also correct
    }
  }, []);

  async function exit() {
    setExiting(true);
    await fetch("/api/coach/act-as", { method: "DELETE" });
    // Back to the screen size the device would show by itself (the desktop coaching shell at a desktop).
    writeViewOverride(null);
    // The coaching Home: /dashboard sends a phone to the coach's usual team or social group (not the group they were standing in, which is their own space or a client's).
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <>
      <div className="relative z-30 bg-rust text-graphite px-5 py-2.5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-label={self ? "Viewing yourself. Pick a client to look at instead" : `Viewing ${athleteFullName}. Pick someone else`}
          className="flex items-center gap-1 min-h-8 max-w-[34%] font-body text-xs font-medium"
        >
          <span className="truncate">{self ? "Me" : athleteFullName}</span>
          <ChevronDown className="w-4 h-4 shrink-0" strokeWidth={2.5} />
        </button>
        <button type="button" onClick={exit} disabled={exiting} className="shrink-0 min-h-8 font-body text-xs uppercase tracking-wide underline underline-offset-2 disabled:opacity-50">
          {exiting ? "Going…" : "Coach home"}
        </button>
      </div>

      {pickerOpen && <ViewAsClientPicker onClose={() => setPickerOpen(false)} />}
      <TerminologyProvider groupId={groupId}>
        <CoachSpotHub groupId={groupId} />
      </TerminologyProvider>
    </>
  );
}
