"use client";

import { useEffect, useState } from "react";
import { formatMMSS } from "@/lib/rest-timer-math";

// Genuinely prominent, not tucked in a corner — the whole point of the
// original ask. Ticks from the session's real started_at, so it's
// correct immediately on load regardless of when this component mounted.
export function SessionStopwatch({ startedAt }: { startedAt: string }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  );

  useEffect(() => {
    const startedAtMs = new Date(startedAt).getTime();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <p className="font-display text-3xl leading-none text-chalk tabular-nums">
      {formatMMSS(elapsedSeconds)}
    </p>
  );
}
