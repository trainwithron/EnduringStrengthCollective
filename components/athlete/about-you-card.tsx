"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// A one-time, dismissible card on a client's Home for anyone who has not told us about themself yet. Dismissed per person on this device; it never returns once
// they have filled the screen in (the page only renders it while something is missing).
export function AboutYouCard({ groupId, athleteId }: { groupId: string; athleteId: string }) {
  const key = `spotlight.aboutYou.dismissed.v1:${athleteId}`;
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(!window.localStorage.getItem(key));
    } catch {
      setShow(true);
    }
  }, [key]);
  if (!show) return null;
  return (
    <div className="border border-rust/50 bg-surface/40 px-4 py-3 flex items-start justify-between gap-3">
      <div>
        <p className="font-body text-sm text-chalk">Tell your coach about you</p>
        <p className="font-body text-xs text-steel mt-0.5">Height, weight and activity, a minute. It lets them set a starting target.</p>
        <Link href={`/groups/${groupId}/about-you`} className="inline-block mt-2 font-body text-sm text-rust underline underline-offset-2">
          Fill it in
        </Link>
      </div>
      <button
        type="button"
        aria-label="Hide this for now"
        className="font-body text-sm text-steel px-2"
        onClick={() => {
          try {
            window.localStorage.setItem(key, "1");
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
