"use client";

import { useEffect, useRef, useState } from "react";
import {
  createWhackAMoleGame,
  stepWhackAMoleTick,
  whackHole,
  HOLE_COUNT,
  type Mole,
  type WhackAMoleState,
} from "@/lib/whack-a-mole-game";
import { computeDifficultyProgress, computeDifficultyMultiplier } from "@/lib/rest-timer-difficulty";
import { readGameHighScore, recordGameHighScore } from "@/lib/rest-timer-high-score";

const GAME_KEY = "whack-a-mole";
const TICK_MS = 100;

// Rest-timer mini-game library, whack-a-mole entry (Phase 4,
// custom_shape_theming_idea.md) — flagged in the original spec as an
// especially good fit for the 45s-minimum short window. Spawn rate and
// how long a mole stays up both ramp against real elapsed rest time.
//
// This one is DOM (a grid of real buttons), not canvas, so the
// rAF+imperative-draw pattern the other 5 games use doesn't directly
// apply — see rest_timer_minigame_performance_investigation.md. Instead:
// the tick loop still runs via requestAnimationFrame + a time-accumulator
// (same fixed 100ms cadence as before) driving a ref-held authoritative
// state, but React state only gets touched with the tick's actual
// result — and `stepWhackAMoleTick` now preserves the same `moles` array
// reference on a tick where nothing expired (the common case, since
// mole-up time is several ticks long), so calling setState with it is a
// no-op React bails out of via reference equality. Net effect: this game
// only re-renders when a mole actually spawns/expires or the score/miss
// count changes, not on every single 100ms tick.
export function WhackAMoleMiniGame({
  onClose,
  startedAtMs,
  durationSeconds,
}: {
  onClose: () => void;
  startedAtMs: number;
  durationSeconds: number;
}) {
  const gameRef = useRef<WhackAMoleState>(createWhackAMoleGame());
  const [moles, setMoles] = useState<Mole[]>([]);
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [status, setStatus] = useState<"playing" | "over">("playing");
  const [highScore, setHighScore] = useState(0);
  const rafRef = useRef<number | null>(null);
  const accumulatorRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setHighScore(readGameHighScore(GAME_KEY));
  }, []);

  useEffect(() => {
    if (status === "over") return;

    lastFrameRef.current = null;
    accumulatorRef.current = 0;

    function frame(now: number) {
      if (lastFrameRef.current == null) lastFrameRef.current = now;
      const dt = now - lastFrameRef.current;
      lastFrameRef.current = now;
      accumulatorRef.current = Math.min(accumulatorRef.current + dt, TICK_MS * 10);

      while (accumulatorRef.current >= TICK_MS) {
        const progress = computeDifficultyProgress(Date.now() - startedAtMs, durationSeconds * 1000);
        const spawnIntervalMs = computeDifficultyMultiplier(progress, 900, 400);
        const moleUpMs = computeDifficultyMultiplier(progress, 1100, 550);
        gameRef.current = stepWhackAMoleTick(gameRef.current, TICK_MS, spawnIntervalMs, moleUpMs);
        accumulatorRef.current -= TICK_MS;
        if (gameRef.current.status === "over") break;
      }

      // Each setter bails out on its own (Object.is for the primitives,
      // reference equality for `moles`) when nothing actually changed —
      // no need to hand-roll that comparison here.
      setMoles(gameRef.current.moles);
      setMisses(gameRef.current.misses);
      if (gameRef.current.status === "over") {
        setStatus("over");
        return;
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [status, startedAtMs, durationSeconds]);

  useEffect(() => {
    if (status === "over") {
      setHighScore(recordGameHighScore(GAME_KEY, gameRef.current.score));
    }
  }, [status]);

  function handleWhack(holeIndex: number) {
    gameRef.current = whackHole(gameRef.current, holeIndex);
    setMoles(gameRef.current.moles);
    setScore(gameRef.current.score);
  }

  function handleRestart() {
    gameRef.current = createWhackAMoleGame();
    setMoles([]);
    setScore(0);
    setMisses(0);
    setStatus("playing");
  }

  const upHoles = new Set(moles.map((m) => m.holeIndex));

  return (
    <div className="mt-2 p-3 border border-steel/20 bg-graphite/60 flex flex-col items-center gap-2">
      <div className="w-full flex items-center justify-between font-body text-xs text-steel">
        <span>
          Score: <span className="text-chalk">{score}</span> · Best:{" "}
          <span className="text-chalk">{highScore}</span> · Misses:{" "}
          <span className="text-rust">{misses}</span>
        </span>
        <button type="button" onClick={onClose} className="text-steel active:text-rust transition-colors">
          Close ✕
        </button>
      </div>
      <div className="relative">
        <div className="grid grid-cols-3 gap-2" style={{ width: 210 }}>
          {Array.from({ length: HOLE_COUNT }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleWhack(i)}
              className={`w-[66px] h-[66px] rounded-full border-2 transition-colors ${
                upHoles.has(i) ? "bg-rust border-rust" : "bg-graphite border-steel/30"
              }`}
              aria-label={upHoles.has(i) ? `Whack hole ${i + 1}` : `Empty hole ${i + 1}`}
            />
          ))}
        </div>
        {status === "over" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-graphite/85">
            <p className="font-display text-chalk uppercase text-sm">Game over</p>
            <button
              type="button"
              onClick={handleRestart}
              className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium"
            >
              Play again
            </button>
          </div>
        )}
      </div>
      <p className="font-body text-[11px] text-steel">Tap the lit holes — purely optional.</p>
    </div>
  );
}
