"use client";

import { useEffect, useRef, useState } from "react";
import {
  createFlappyGame,
  stepFlappyGame,
  BOARD_WIDTH,
  BOARD_HEIGHT,
  BIRD_X,
  BIRD_RADIUS,
  PIPE_WIDTH,
  type FlappyGameState,
} from "@/lib/flappy-game";
import { computeDifficultyProgress, computeDifficultyMultiplier } from "@/lib/rest-timer-difficulty";
import { readGameHighScore, recordGameHighScore } from "@/lib/rest-timer-high-score";

const GAME_KEY = "flappy";
const TICK_MS = 40;
const RUST = "#D2703B";
const GRAPHITE = "#1C1B1A";
const STEEL = "#908B7E";

// Rest-timer mini-game library, tap-to-fly entry (Phase 4,
// custom_shape_theming_idea.md) — purely optional content riding on top
// of the already-running rest countdown. Difficulty (scroll speed +
// gap width) ramps against real elapsed rest time via the shared
// lib/rest-timer-difficulty.ts engine, not its own internal clock, so
// closing and reopening the game panel doesn't reset the ramp.
//
// requestAnimationFrame + a ref-held game state, same pattern as
// breakout-mini-game.tsx — see that file's header comment and
// rest_timer_minigame_performance_investigation.md for why.
export function FlappyMiniGame({
  onClose,
  startedAtMs,
  durationSeconds,
}: {
  onClose: () => void;
  startedAtMs: number;
  durationSeconds: number;
}) {
  const gameRef = useRef<FlappyGameState>(createFlappyGame());
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState<"playing" | "over">("playing");
  const [highScore, setHighScore] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flapRequestedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const accumulatorRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setHighScore(readGameHighScore(GAME_KEY));
  }, []);

  function draw(state: FlappyGameState) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const progress = computeDifficultyProgress(Date.now() - startedAtMs, durationSeconds * 1000);
    const gapHeight = computeDifficultyMultiplier(progress, 150, 90);
    ctx.fillStyle = GRAPHITE;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.fillStyle = STEEL;
    for (const pipe of state.pipes) {
      const gapTop = pipe.gapCenter - gapHeight / 2;
      ctx.fillRect(pipe.x, 0, PIPE_WIDTH, Math.max(0, gapTop));
      ctx.fillRect(pipe.x, gapTop + gapHeight, PIPE_WIDTH, BOARD_HEIGHT);
    }
    ctx.fillStyle = RUST;
    ctx.beginPath();
    ctx.arc(BIRD_X, state.birdY, BIRD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  useEffect(() => {
    if (status === "over") {
      draw(gameRef.current);
      return;
    }

    lastFrameRef.current = null;
    accumulatorRef.current = 0;

    function frame(now: number) {
      if (lastFrameRef.current == null) lastFrameRef.current = now;
      const dt = now - lastFrameRef.current;
      lastFrameRef.current = now;
      accumulatorRef.current = Math.min(accumulatorRef.current + dt, TICK_MS * 10);

      let stepped = false;
      while (accumulatorRef.current >= TICK_MS) {
        const progress = computeDifficultyProgress(Date.now() - startedAtMs, durationSeconds * 1000);
        const scrollSpeed = computeDifficultyMultiplier(progress, 2, 5);
        const gapHeight = computeDifficultyMultiplier(progress, 150, 90);
        gameRef.current = stepFlappyGame(gameRef.current, flapRequestedRef.current, scrollSpeed, gapHeight);
        flapRequestedRef.current = false;
        accumulatorRef.current -= TICK_MS;
        stepped = true;
        if (gameRef.current.status === "over") break;
      }

      draw(gameRef.current);

      if (stepped) {
        setScore(gameRef.current.score);
        if (gameRef.current.status === "over") {
          setStatus("over");
          return;
        }
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

  function handleFlap() {
    flapRequestedRef.current = true;
  }

  function handleRestart() {
    gameRef.current = createFlappyGame();
    flapRequestedRef.current = false;
    setScore(0);
    setStatus("playing");
  }

  return (
    <div className="mt-2 p-3 border border-steel/20 bg-graphite/60 flex flex-col items-center gap-2">
      <div className="w-full flex items-center justify-between font-body text-xs text-steel">
        <span>
          Score: <span className="text-chalk">{score}</span> · Best:{" "}
          <span className="text-chalk">{highScore}</span>
        </span>
        <button type="button" onClick={onClose} className="text-steel active:text-rust transition-colors">
          Close ✕
        </button>
      </div>
      <div className="relative touch-none" onPointerDown={handleFlap}>
        <canvas
          ref={canvasRef}
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
          className="max-w-full"
          style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}
          role="img"
          aria-label={`Flappy mini-game, score ${score}`}
        />
        {status === "over" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-graphite/80">
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
      <p className="font-body text-[11px] text-steel">Tap to fly — purely optional.</p>
    </div>
  );
}
