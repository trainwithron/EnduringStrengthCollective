"use client";

import { useEffect, useRef, useState } from "react";
import { computeRemainingSeconds, formatMMSS } from "@/lib/rest-timer-math";
import { readRestTimerState, writeRestTimerState, clearRestTimerState } from "@/lib/rest-timer-storage";
import { playRestAlert } from "@/lib/rest-alert";
import { MIN_REST_SECONDS_FOR_GAME } from "@/lib/rest-timer-difficulty";
import { SessionStopwatch } from "./session-stopwatch";
import { SnakeMiniGame } from "./snake-mini-game";
import { FlappyMiniGame } from "./flappy-mini-game";
import { EndlessRunnerMiniGame } from "./endless-runner-mini-game";
import { WhackAMoleMiniGame } from "./whack-a-mole-mini-game";
import { BreakoutMiniGame } from "./breakout-mini-game";
import { LaneDodgeMiniGame } from "./lane-dodge-mini-game";

const PRESETS = [60, 90, 120];

// The rest-timer mini-game library (Phase 4, custom_shape_theming_idea.md)
// — Ron's confirmed six, Tetris/2048/Simon Says explicitly excluded as
// worse fits for the escalating-difficulty-to-natural-death mechanic.
type GameKey = "snake" | "flappy" | "runner" | "whack-a-mole" | "breakout" | "lane-dodge";
const GAME_LABELS: Record<GameKey, string> = {
  snake: "Snake",
  flappy: "Flappy",
  runner: "Runner",
  "whack-a-mole": "Whack-a-Mole",
  breakout: "Breakout",
  "lane-dodge": "Lane Dodge",
};
const GAME_ORDER: GameKey[] = ["snake", "flappy", "runner", "whack-a-mole", "breakout", "lane-dodge"];

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
  // to that exercise's own target rest if it has one. When isPrescribed
  // is true, the coach actually specified this rest period, so the
  // countdown auto-starts immediately instead of waiting for a tap.
  pendingPrompt: { defaultSeconds: number; isPrescribed: boolean } | null;
  onPromptHandled: () => void;
}) {
  const [running, setRunning] = useState<RunningState | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [justFinished, setJustFinished] = useState(false);
  const [selectedGame, setSelectedGame] = useState<GameKey | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const wakeLockRef = useRef<any>(null);

  // Purely optional content riding on the countdown, per the governing
  // "never blocks" constraint — closes itself the instant rest actually
  // ends (whether that's the timer completing or a manual skip) so
  // nobody's staring at a stale game board once it's time for the next
  // set, without the game itself needing to know anything about why.
  useEffect(() => {
    if (!running) {
      setSelectedGame(null);
      setPickerOpen(false);
    }
  }, [running]);

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

  // A coach-prescribed rest period needs no manual pick — auto-start the
  // countdown the moment the prompt arrives (still skippable/+15s-able
  // like any other running timer). A generic (unprescribed) completion
  // still falls through to the tap-a-preset prompt below.
  useEffect(() => {
    if (pendingPrompt?.isPrescribed && !running) {
      startPreset(pendingPrompt.defaultSeconds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

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
            {/* Below the 45s minimum, no mini-game — just the plain
                countdown above. A real game needs a real ~20-25s+
                window to feel like a game rather than a flash on
                screen (custom_shape_theming_idea.md). */}
            {running.durationSeconds >= MIN_REST_SECONDS_FOR_GAME && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => (selectedGame ? setSelectedGame(null) : setPickerOpen((v) => !v))}
                  className={`h-8 px-2.5 border font-body text-xs ${
                    selectedGame ? "bg-rust border-rust text-graphite" : "border-steel/30 text-steel"
                  }`}
                >
                  🎮 {selectedGame ? "Hide" : "Play"}
                </button>
                {pickerOpen && !selectedGame && (
                  <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-steel/30 py-1 w-40">
                    {GAME_ORDER.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSelectedGame(key);
                          setPickerOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 font-body text-xs text-chalk active:text-rust"
                      >
                        {GAME_LABELS[key]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {justFinished && !running && (
          <p className="font-body text-sm text-rust">Rest complete! 💪</p>
        )}
      </div>

      {running && selectedGame && (
        <MiniGameSlot
          gameKey={selectedGame}
          startedAtMs={running.startedAtMs}
          durationSeconds={running.durationSeconds}
          onClose={() => setSelectedGame(null)}
        />
      )}

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

// A thin switch over the six-game library — keeps rest-timer-bar.tsx
// itself from needing to know each game's own prop shape beyond the
// three they all share (onClose, startedAtMs, durationSeconds).
function MiniGameSlot({
  gameKey,
  startedAtMs,
  durationSeconds,
  onClose,
}: {
  gameKey: GameKey;
  startedAtMs: number;
  durationSeconds: number;
  onClose: () => void;
}) {
  switch (gameKey) {
    case "snake":
      return <SnakeMiniGame onClose={onClose} startedAtMs={startedAtMs} durationSeconds={durationSeconds} />;
    case "flappy":
      return <FlappyMiniGame onClose={onClose} startedAtMs={startedAtMs} durationSeconds={durationSeconds} />;
    case "runner":
      return <EndlessRunnerMiniGame onClose={onClose} startedAtMs={startedAtMs} durationSeconds={durationSeconds} />;
    case "whack-a-mole":
      return <WhackAMoleMiniGame onClose={onClose} startedAtMs={startedAtMs} durationSeconds={durationSeconds} />;
    case "breakout":
      return <BreakoutMiniGame onClose={onClose} startedAtMs={startedAtMs} durationSeconds={durationSeconds} />;
    case "lane-dodge":
      return <LaneDodgeMiniGame onClose={onClose} startedAtMs={startedAtMs} durationSeconds={durationSeconds} />;
  }
}
