"use client";

import { useEffect, useRef, useState } from "react";
import { computeRemainingSeconds, formatMMSS } from "@/lib/rest-timer-math";
import { readRestTimerState, writeRestTimerState, clearRestTimerState } from "@/lib/rest-timer-storage";
import { playRestAlert } from "@/lib/rest-alert";
import { SessionStopwatch } from "./session-stopwatch";

const PRESETS = [60, 90, 120];

interface RunningState {
  startedAtMs: number;
  durationSeconds: number;
}

export function RestTimerBar({
  sessionId,
  startedAt,
  pendingPrompt,
  onPromptHandled,
}: {
  sessionId: string;
  startedAt: string;
  // A set just auto-completed — offer to start a rest timer, defaulting
  // to that exercise's own target rest if it has one.
  pendingPrompt: { defaultSeconds: number } | null;
  onPromptHandled: () => void;
}) {
  const [running, setRunning] = useState<RunningState | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [justFinished, setJustFinished] = useState(false);
  const wakeLockRef = useRef<any>(null);

  async function acquireWakeLock() {
    try {
      wakeLockRef.current = await (navigator as any).wakeLock?.request("screen");
    } catch {
      // Unsupported or refused — best-effort only.
    }
  }

  function releaseWakeLock() {
    try {
      wakeLockRef.current?.release?.();
    } catch {
      // Non-fatal.
    }
    wakeLockRef.current = null;
  }

  // Resume an in-progress countdown after a reload/nav-away-and-back.
  useEffect(() => {
    const stored = readRestTimerState(sessionId);
    if (!stored) return;
    const remainingNow = computeRemainingSeconds(stored.startedAtMs, stored.durationSeconds, Date.now());
    if (remainingNow > 0) {
      setRunning(stored);
      setRemaining(remainingNow);
      acquireWakeLock();
    } else {
      clearRestTimerState(sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      const remainingNow = computeRemainingSeconds(running.startedAtMs, running.durationSeconds, Date.now());
      setRemaining(remainingNow);
      if (remainingNow <= 0) {
        clearInterval(interval);
        playRestAlert();
        releaseWakeLock();
        clearRestTimerState(sessionId);
        setRunning(null);
        setJustFinished(true);
        setTimeout(() => setJustFinished(false), 4000);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [running, sessionId]);

  function startPreset(seconds: number) {
    const next: RunningState = { startedAtMs: Date.now(), durationSeconds: seconds };
    setRunning(next);
    setRemaining(seconds);
    writeRestTimerState(sessionId, next);
    acquireWakeLock();
    onPromptHandled();
  }

  function addFifteen() {
    if (!running) return;
    const next: RunningState = { ...running, durationSeconds: running.durationSeconds + 15 };
    setRunning(next);
    writeRestTimerState(sessionId, next);
  }

  function skip() {
    releaseWakeLock();
    clearRestTimerState(sessionId);
    setRunning(null);
  }

  const showPrompt = pendingPrompt && !running;

  return (
    <div className="sticky top-0 z-10 bg-graphite border-b border-steel/20 px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        <SessionStopwatch startedAt={startedAt} />

        {running && (
          <div className="flex items-center gap-3">
            <p className="font-display text-3xl leading-none text-rust tabular-nums">
              {formatMMSS(remaining)}
            </p>
            <button
              type="button"
              onClick={addFifteen}
              className="h-8 px-2.5 border border-steel/30 text-steel font-body text-xs"
            >
              +15s
            </button>
            <button
              type="button"
              onClick={skip}
              className="h-8 px-2.5 border border-steel/30 text-steel font-body text-xs"
            >
              Skip
            </button>
          </div>
        )}

        {justFinished && !running && (
          <p className="font-body text-sm text-rust">Rest complete! 💪</p>
        )}
      </div>

      {showPrompt && (
        <div className="flex items-center gap-2 mt-2.5">
          <span className="font-body text-xs text-steel">Rest?</span>
          {PRESETS.map((seconds) => (
            <button
              key={seconds}
              type="button"
              onClick={() => startPreset(seconds)}
              className={`h-8 px-3 font-body text-xs border ${
                seconds === pendingPrompt!.defaultSeconds
                  ? "bg-rust border-rust text-graphite"
                  : "border-steel/30 text-steel"
              }`}
            >
              {seconds}s
            </button>
          ))}
          {!PRESETS.includes(pendingPrompt!.defaultSeconds) && (
            <button
              type="button"
              onClick={() => startPreset(pendingPrompt!.defaultSeconds)}
              className="h-8 px-3 font-body text-xs border bg-rust border-rust text-graphite"
            >
              {pendingPrompt!.defaultSeconds}s
            </button>
          )}
          <button
            type="button"
            onClick={onPromptHandled}
            aria-label="Dismiss rest timer prompt"
            className="ml-auto font-body text-xs text-steel"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
