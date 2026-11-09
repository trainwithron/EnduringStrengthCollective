"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// The first thing on a client's Home until their goal sheet is filled in (Ron, Nov 9: "goals sheet needs to be prompted to clients to complete upon sign in").
// "Not now" hides it for the rest of that day on this device; it comes back the next day and stops for good once the sheet is filled in (the page only renders it while it is not).
export function GoalSheetPromptCard({ groupId, athleteId }: { groupId: string; athleteId: string }) {
  const key = `spotlight.goalSheetPrompt.notNow.v1:${athleteId}:${groupId}`;
  const [show, setShow] = useState(false);
  const today = () => new Date().toLocaleDateString("en-CA");
  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(key) !== today());
    } catch {
      setShow(true);
    }
  }, [key]);
  if (!show) return null;
  return (
    <div className="border border-rust/50 bg-surface/40 px-4 py-3 flex items-start justify-between gap-3">
      <div>
        <p className="font-body text-sm text-chalk">Fill out your goal sheet</p>
        <p className="font-body text-xs text-steel mt-0.5">A few questions so your coach can build your plan around what you want.</p>
        <Link href={`/groups/${groupId}/goal#goal-sheet`} className="inline-flex items-center min-h-11 mt-2 font-body text-sm text-rust underline underline-offset-2">
          Fill it out
        </Link>
      </div>
      <button
        type="button"
        aria-label="Hide this for today"
        className="inline-flex items-center min-h-11 font-body text-sm text-steel px-2"
        onClick={() => {
          try {
            window.localStorage.setItem(key, today());
          } catch {
            /* a blocked store just means it shows again next time */
          }
          setShow(false);
        }}
      >
        Not now
      </button>
    </div>
  );
}
