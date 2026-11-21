"use client";

import { useEffect, useRef, useState } from "react";
import { computeRemainingSeconds, formatMMSS } from "@/lib/rest-timer-math";
import { readRestTimerState, writeRestTimerState, clearRestTimerState } from "@/lib/rest-timer-storage";
import { playRestAlert } from "@/lib/rest-alert";
import { formatRest, formatRestSpan } from "@/lib/rest-time";
import { MIN_REST_SECONDS_FOR_GAME } from "@/lib/rest-timer-difficulty";
import { createBrowserClient } from "@/lib/supabase/client";
import { SnakeMiniGame } from "./snake-mini-game";
import { FlappyMiniGame } from "./flappy-mini-game";
import { EndlessRunnerMiniGame } from "./endless-runner-mini-game";
import { WhackAMoleMiniGame } from "./whack-a-mole-mini-game";
import { BreakoutMiniGame } from "./breakout-mini-game";
import { LaneDodgeMiniGame } from "./lane-dodge-mini-game";
import { TriviaMiniGame } from "./trivia-mini-game";
import { WellnessCheckinWidget } from "@/components/athlete/wellness-checkin-widget";
import { ReadSlot } from "./read-slot";
import type { ReadForViewer } from "@/lib/read-content/for-viewer";

// A real pending item — a habit that's due today and not yet checked
// off, or no wellness check-in submitted today — becomes the unlock key
// for that rest period's mini-game/trivia, rather than a nudge running
// alongside it freely. Only ever set when a genuine pending item exists
// (computed server-side, see app/sessions/[sessionId]/page.tsx) — never
// invented to fill space when there's nothing actually due.
export type PendingGateTask = { kind: "habit"; habitId: string; title: string } | { kind: "wellness" };

const PRESETS = [60, 90, 120];

// The rest-timer mini-game library (Phase 4, custom_shape_theming_idea.md)
// — Ron's confirmed six arcade games, Tetris/2048/Simon Says explicitly
// excluded as worse fits for the escalating-difficulty-to-natural-death
// mechanic — plus trivia, a genuinely different pacing shape (a fixed-
// time flash round, not a difficulty ramp), listed alongside them.
type GameKey = "snake" | "flappy" | "runner" | "whack-a-mole" | "breakout" | "lane-dodge" | "trivia";
const GAME_LABELS: Record<GameKey, string> = {
  snake: "Snake",
  flappy: "Flappy",
  runner: "Runner",
  "whack-a-mole": "Whack-a-Mole",
  breakout: "Breakout",
  "lane-dodge": "Lane Dodge",
  trivia: "Trivia",
};
const GAME_ORDER: GameKey[] = ["snake", "flappy", "runner", "whack-a-mole", "breakout", "lane-dodge", "trivia"];

interface RunningState {
  startedAtMs: number;
  durationSeconds: number;
  // "coach": the rest the coach prescribed for this set (no extending it); "typed": a rest the client typed (as before).
  source?: "coach" | "typed";
  prescribedSeconds?: number;
  readySeconds?: number;
}

export function RestTimerBar({
  sessionId,
  pendingPrompt,
  onPromptHandled,
  pendingTask,
  athleteId,
  groupId,
  todayDate,
  read,
  nextUp = null,
}: {
  // The exercise that comes after this rest (the bottom bar's Next), shown on the rest sheet.
  nextUp?: string | null;
  sessionId: string;
  // A set just auto-completed — offer to start a rest timer, defaulting
  // to that exercise's own target rest if it has one. When isPrescribed
  // is true, the coach actually specified this rest period, so the
  // countdown auto-starts immediately instead of waiting for a tap.
  pendingPrompt: { defaultSeconds: number; isPrescribed: boolean; source?: "coach" | "typed"; readySeconds?: number } | null;
  onPromptHandled: () => void;
  // A real pending item (a due habit, an unanswered wellness check-in)
  // gates the game picker behind resolving it first — null whenever
  // nothing is genuinely pending, in which case the picker behaves
  // exactly as it always has.
  pendingTask?: PendingGateTask | null;
  athleteId?: string;
  groupId?: string;
  todayDate?: string;
  // Today's short reading for this person, or null/undefined when Read is off or not offered (never offered when a coach is logging for a client).
  read?: ReadForViewer | null;
}) {
  const [running, setRunning] = useState<RunningState | null>(null);
  const [readOpen, setReadOpen] = useState(false);
  // Turning Read off from the panel hides the button for the rest of this visit without waiting for a reload.
  const [readTurnedOff, setReadTurnedOff] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [justFinished, setJustFinished] = useState(false);
  const [selectedGame, setSelectedGame] = useState<GameKey | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Once resolved, stays resolved for the rest of this session — the
  // gate only ever needs to be cleared once, not re-cleared on every
  // rest period.
  const [taskResolved, setTaskResolved] = useState(!pendingTask);
  const [gateOpen, setGateOpen] = useState(false);
  const [habitSaving, setHabitSaving] = useState(false);
  const wakeLockRef = useRef<any>(null);
  // A rest range: the alert for reaching its low end is played once.
  const readyAlerted = useRef(false);

  // Purely optional content riding on the countdown, per the governing
  // "never blocks" constraint — closes itself the instant rest actually
  // ends (whether that's the timer completing or a manual skip) so
  // nobody's staring at a stale game board once it's time for the next
  // set, without the game itself needing to know anything about why.
  useEffect(() => {
    if (!running) {
      setSelectedGame(null);
      setPickerOpen(false);
      setReadOpen(false);
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
      readyAlerted.current = stored.readySeconds != null && stored.durationSeconds - remainingNow >= stored.readySeconds;
      setRunning(stored);
      setRemaining(remainingNow);
      acquireWakeLock();
    } else {
      clearRestTimerState(sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // The phone locks or the app goes to the background: the countdown is timestamp-based (it never drifts), so on coming back show the true time at once and take the screen wake lock again (the browser lets it go when the page is hidden).
  useEffect(() => {
    if (!running) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setRemaining(computeRemainingSeconds(running.startedAtMs, running.durationSeconds, Date.now()));
      void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      const remainingNow = computeRemainingSeconds(running.startedAtMs, running.durationSeconds, Date.now());
      setRemaining(remainingNow);
      // A rest range: tell the client when the low end is reached (they may go now), and keep counting to the high end.
      if (running.readySeconds != null && !readyAlerted.current && running.durationSeconds - remainingNow >= running.readySeconds) {
        readyAlerted.current = true;
        playRestAlert();
      }
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

  function startPreset(seconds: number, source?: "coach" | "typed", readySeconds?: number) {
    readyAlerted.current = false;
    const next: RunningState = {
      startedAtMs: Date.now(),
      durationSeconds: seconds,
      ...(source ? { source } : {}),
      ...(source === "coach" ? { prescribedSeconds: seconds } : {}),
      ...(source === "coach" && readySeconds ? { readySeconds } : {}),
    };
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
      startPreset(pendingPrompt.defaultSeconds, pendingPrompt.source, pendingPrompt.readySeconds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  function addFifteen() {
    // The coach's rest for this set is exactly that long: it is not extended from the app.
    if (!running || running.source === "coach") return;
    const next: RunningState = { ...running, durationSeconds: running.durationSeconds + 15 };
    setRunning(next);
    writeRestTimerState(sessionId, next);
  }

  function skip() {
    releaseWakeLock();
    clearRestTimerState(sessionId);
    setRunning(null);
  }

  async function handleCompleteHabit() {
    if (pendingTask?.kind !== "habit" || !todayDate || habitSaving) return;
    setHabitSaving(true);
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("habit_logs")
      .upsert(
        { habit_id: pendingTask.habitId, log_date: todayDate, completed_at: new Date().toISOString() },
        { onConflict: "habit_id,log_date" }
      );
    setHabitSaving(false);
    if (!error) {
      setTaskResolved(true);
      setGateOpen(false);
    }
  }

  const showPrompt = pendingPrompt && !running;
  // A rest can be started any time from the workout's bottom bar ("Rest 90s"), not only when a set is ticked (Ron, Oct 31: he fills all the sets in up front once the weight is agreed, and
  // still needs the timer between them). Nothing asked and nothing running: nothing here.
  if (!showPrompt && !running && !justFinished) return null;

  // The ring: how much of the rest is left.
  const ringR = 52;
  const ringC = 2 * Math.PI * ringR;
  const ringLeft = running && running.durationSeconds > 0 ? Math.max(0, Math.min(1, remaining / running.durationSeconds)) : 0;
  const chip = (on: boolean) =>
    `flex-1 min-w-0 h-11 rounded-token-pill font-body text-[13px] ${on ? "bg-rust/15 text-rust-ink font-semibold" : "bg-surface-2 text-steel"}`;

  return (
    <>
      {/* "Rest complete" for a few seconds after the countdown ends, above the bottom bar. */}
      {justFinished && !running && !showPrompt && (
        <p role="status" className="fixed left-5 right-5 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-40 rounded-card tint-win bg-surface px-4 py-3 font-body text-sm text-chalk text-center">
          Rest complete! 💪
        </p>
      )}

      {/* A set was just done and the coach set no rest for it: "Rest?" with the three lengths (the one that fits highlighted), or ✕. */}
      {showPrompt && (
        <section aria-label="Start a rest" className="fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-surface border-t border-rust/25 px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-16px_40px_rgb(0_0_0/0.5)]">
          <span aria-hidden="true" className="block mx-auto mb-3 w-10 h-1 rounded-full bg-steel/40" />
          <div className="flex items-center gap-2">
            <span className="font-body text-sm font-semibold text-chalk shrink-0">Rest?</span>
            {PRESETS.map((seconds) => (
              <button key={seconds} type="button" onClick={() => startPreset(seconds)} className={chip(seconds === pendingPrompt!.defaultSeconds)}>
                {seconds}s
              </button>
            ))}
            {!PRESETS.includes(pendingPrompt!.defaultSeconds) && (
              <button type="button" onClick={() => startPreset(pendingPrompt!.defaultSeconds)} className={chip(true)}>
                {pendingPrompt!.defaultSeconds}s
              </button>
            )}
            <button
              type="button"
              onClick={onPromptHandled}
              aria-label="Dismiss rest timer prompt"
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full font-body text-sm text-steel"
            >
              ✕
            </button>
          </div>
        </section>
      )}

      {/* Resting (Look Refresh, client step, Ron Nov 20): a sheet up from the bottom with a big countdown ring, what is next, +15s, the 60 / 90 / 120 lengths, Read and the game, and a big
          Skip rest. The coach's own rest keeps its rule: no +15s and no other length on it (Skip stays). */}
      {running && (
        <section
          aria-label="Rest timer"
          data-rest-sheet
          className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-[28px] bg-surface border-t border-rust/25 px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[0_-16px_40px_rgb(0_0_0/0.5)] flex flex-col gap-3.5"
        >
          <span aria-hidden="true" className="block mx-auto w-10 h-1 rounded-full bg-steel/40" />

          {readOpen && read && !readTurnedOff && athleteId && (
            <ReadSlot
              athleteId={athleteId}
              reference={read.ref}
              text={read.text}
              noteSeen={read.noteSeen}
              onClose={() => setReadOpen(false)}
              onTurnedOff={() => {
                setReadTurnedOff(true);
                setReadOpen(false);
              }}
            />
          )}

          {selectedGame && (
            <MiniGameSlot
              gameKey={selectedGame}
              startedAtMs={running.startedAtMs}
              durationSeconds={running.durationSeconds}
              onClose={() => setSelectedGame(null)}
            />
          )}

          <div className="flex items-center gap-5">
            <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`${formatMMSS(remaining)} of rest left`} className="shrink-0">
              <circle cx="60" cy="60" r={ringR} fill="none" stroke="rgb(var(--line))" strokeWidth="10" />
              {ringLeft > 0 && (
                <circle
                  cx="60"
                  cy="60"
                  r={ringR}
                  fill="none"
                  stroke="rgb(var(--rust))"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${(ringLeft * ringC).toFixed(1)} ${ringC.toFixed(1)}`}
                  transform="rotate(-90 60 60)"
                />
              )}
              <text x="60" y="70" textAnchor="middle" fill="rgb(var(--chalk))" className="font-display" fontSize="30">
                {formatMMSS(remaining)}
              </text>
            </svg>
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <p className="font-body text-[13px] text-steel">{nextUp ? "Resting · next up" : "Resting"}</p>
              {nextUp && <p className="font-body text-base font-semibold text-chalk truncate">{nextUp}</p>}
              {running.source !== "coach" && (
                <button type="button" onClick={addFifteen} className="h-11 rounded-token-pill border border-steel/40 text-chalk font-body text-sm font-semibold">
                  +15s
                </button>
              )}
            </div>
          </div>

          {running.source === "coach" && (
            <p className="font-body text-xs text-steel">
              {running.readySeconds != null
                ? running.durationSeconds - remaining >= running.readySeconds
                  ? `You can go now. Your coach's rest is ${formatRestSpan(running.readySeconds, running.durationSeconds)}.`
                  : `Rest ${formatRestSpan(running.readySeconds, running.durationSeconds)} (set by your coach)`
                : `Rest ${formatRest(running.prescribedSeconds ?? running.durationSeconds)} (set by your coach)`}
            </p>
          )}

          <div className="flex items-center gap-2">
            {running.source !== "coach" &&
              PRESETS.map((seconds) => (
                <button key={seconds} type="button" onClick={() => startPreset(seconds)} className={chip(seconds === running.durationSeconds)}>
                  {seconds}s
                </button>
              ))}
            {read && !readTurnedOff && (
              <button
                type="button"
                onClick={() => {
                  setSelectedGame(null);
                  setPickerOpen(false);
                  setReadOpen((v) => !v);
                }}
                className={chip(readOpen)}
              >
                📖 {readOpen ? "Hide" : "Read"}
              </button>
            )}
            {/* Below the 45s minimum, no mini-game — just the plain
                countdown above. A real game needs a real ~20-25s+
                window to feel like a game rather than a flash on
                screen (custom_shape_theming_idea.md). */}
            {running.durationSeconds >= MIN_REST_SECONDS_FOR_GAME && (
              <div className="relative flex-1 min-w-0 flex">
                {pendingTask && !taskResolved ? (
                  <button type="button" onClick={() => setGateOpen((v) => !v)} className={chip(gateOpen)}>
                    🔒 Unlock
                  </button>
                ) : (
                  <button type="button" onClick={() => (selectedGame ? setSelectedGame(null) : setPickerOpen((v) => !v))} className={chip(!!selectedGame)}>
                    🎮 {selectedGame ? "Hide" : "Game"}
                  </button>
                )}
                {pickerOpen && !selectedGame && !(pendingTask && !taskResolved) && (
                  <div className="absolute right-0 bottom-full mb-2 z-20 rounded-card bg-surface-2 border border-steel/30 py-1 w-44 shadow-lg">
                    {GAME_ORDER.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSelectedGame(key);
                          setPickerOpen(false);
                          setReadOpen(false);
                        }}
                        className="w-full min-h-11 text-left px-3 font-body text-sm text-chalk active:text-rust-ink"
                      >
                        {GAME_LABELS[key]}
                      </button>
                    ))}
                  </div>
                )}
                {gateOpen && pendingTask && !taskResolved && (
                  <div className="absolute right-0 bottom-full mb-2 z-20 rounded-card bg-surface-2 border border-steel/30 p-3 w-72 max-w-[calc(100vw-2.5rem)] shadow-lg">
                    <p className="font-body text-xs text-steel mb-2">
                      Finish this to unlock the mini-game/trivia:
                    </p>
                    {pendingTask.kind === "habit" ? (
                      <button
                        type="button"
                        onClick={handleCompleteHabit}
                        disabled={habitSaving}
                        className="w-full h-11 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
                      >
                        {habitSaving ? "Saving…" : `Mark done: ${pendingTask.title}`}
                      </button>
                    ) : athleteId && groupId && todayDate ? (
                      <WellnessCheckinWidget
                        athleteId={athleteId}
                        groupId={groupId}
                        todayDate={todayDate}
                        initialCheckin={null}
                        onSaved={() => {
                          setTaskResolved(true);
                          setGateOpen(false);
                        }}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>

          <button type="button" onClick={skip} className="w-full h-[54px] rounded-token-pill bg-rust text-graphite font-body text-base font-semibold">
            Skip rest
          </button>
        </section>
      )}
    </>
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
    case "trivia":
      // No difficulty ramp -- a fixed-time flash round, not a survival
      // mechanic, so it doesn't need startedAtMs/durationSeconds at all.
      return <TriviaMiniGame onClose={onClose} />;
  }
}
