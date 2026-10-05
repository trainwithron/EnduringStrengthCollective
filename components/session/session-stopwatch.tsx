"use client";

import { useEffect, useState } from "react";
import { formatMMSS } from "@/lib/rest-timer-math";

// Past an hour, "75:12" reads like a clock error; "1:15:12" reads as time.
function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 3600) return formatMMSS(totalSeconds);
  const h = Math.floor(totalSeconds / 3600);
  const rest = totalSeconds % 3600;
  const mm = String(Math.floor(rest / 60)).padStart(2, "0");
  const ss = String(rest % 60).padStart(2, "0");
  return `${h}:${mm}:${ss}`;
}

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
    // The server renders a second or two before the browser does; the first tick fixes it.
    <p className="font-display text-3xl leading-none text-chalk tabular-nums" suppressHydrationWarning>
      {formatElapsed(elapsedSeconds)}
    </p>
  );
}
