"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { HomeSheet } from "@/components/athlete/home-sheet";
import { FoodSearchLog } from "@/components/athlete/food-search-log";

// The Log food tile on a client's Home (CL10, Ron Nov 21: it took the InBody tile's place; InBody is on My progress) opens the food search in a pop-up over Home, the keyboard up,
// the same way Log weight opens its box. What is added is saved by the search itself; Home then refreshes so the Nutrition card's "Eaten today" counts it.
export const OPEN_FOOD_EVENT = "open-food-log";

export function LogFoodSheet({ athleteId, groupId, logDate }: { athleteId: string; groupId: string; logDate: string }) {
  const [open, setOpen] = useState(false);
  // A fresh search each time it opens.
  const [round, setRound] = useState(0);

  useEffect(() => {
    // flushSync: the search box is on the screen and focused while the tap is still being handled, which is when a phone lets the keyboard come up.
    const openIt = () =>
      flushSync(() => {
        setRound((r) => r + 1);
        setOpen(true);
      });
    window.addEventListener(OPEN_FOOD_EVENT, openIt);
    return () => window.removeEventListener(OPEN_FOOD_EVENT, openIt);
  }, []);

  return (
    <HomeSheet open={open} title="Log food" onClose={() => setOpen(false)} returnFocusTo='[data-tile="food"]' focusFirstField>
      {open && <LogFoodSheetBody key={round} athleteId={athleteId} groupId={groupId} logDate={logDate} />}
    </HomeSheet>
  );
}

// (mounted only while open, so Home renders without the router when it is closed)
function LogFoodSheetBody({ athleteId, groupId, logDate }: { athleteId: string; groupId: string; logDate: string }) {
  const router = useRouter();
  return <FoodSearchLog athleteId={athleteId} groupId={groupId} logDate={logDate} inSheet onLogged={() => router.refresh()} />;
}
