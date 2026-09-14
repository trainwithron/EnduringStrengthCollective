"use client";

import { useEffect, useRef, useState } from "react";
import { createSnakeGame, stepSnakeGame, type Direction, type SnakeGameState } from "@/lib/snake-game";
import { readSnakeHighScore, recordSnakeScore } from "@/lib/rest-timer-high-score";
import { computeDifficultyProgress, computeDifficultyMultiplier } from "@/lib/rest-timer-difficulty";

const GRID_SIZE = 15;
const CELL_PX = 16;
const CANVAS_PX = GRID_SIZE * CELL_PX;
// A calm, casual starting pace, ramping faster as the rest window closes
// (shared difficulty engine, Phase 4's rest-timer-mini-game library) —
// this is dead-time filler, not a twitch game, so the ramp stays gentle
// early and only bites in the back stretch.
const TICK_MS_START = 180;
const TICK_MS_MIN = 90;
const SWIPE_THRESHOLD_PX = 16;

const RUST = "#D2703B";
const CHALK = "#EDE8E0";
const GRAPHITE = "#1C1B1A";

// Phase 4 of the gamified-logging thread — purely optional content
// riding on top of the already-running rest countdown (components/session/
// rest-timer-bar.tsx). Never pauses, extends, or gates that countdown —
// it just fills the same dead time with something to do. The caller is
// responsible for actually unmounting this when the rest period ends.
//
// requestAnimationFrame + a ref-held game state, same pattern as
// breakout-mini-game.tsx — see that file's header comment and
// rest_timer_minigame_performance_investigation.md for why. The tick
// interval itself is still variable (it ramps down as difficulty
// climbs) — a time-accumulator against the currently-computed tick
// length reproduces the old self-scheduling setTimeout's exact
// continuously-ramping feel without a per-tick React re-render.
export function SnakeMiniGame({
  onClose,
  startedAtMs,
  durationSeconds,
}: {
  onClose: () => void;
  startedAtMs: number;
  durationSeconds: number;
}) {
  const gameRef = useRef<SnakeGameState>(createSnakeGame(GRID_SIZE));
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState<"playing" | "over">("playing");
  const [highScore, setHighScore] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingDirectionRef = useRef<Direction | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const accumulatorRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setHighScore(readSnakeHighScore());
  }, []);

  function draw(state: SnakeGameState) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = GRAPHITE;
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);
    ctx.fillStyle = RUST;
    for (const segment of state.snake) {
      ctx.fillRect(segment.x * CELL_PX + 1, segment.y * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2);
    }
    if (state.food.x >= 0) {
      ctx.fillStyle = CHALK;
      ctx.beginPath();
      ctx.arc(
        state.food.x * CELL_PX + CELL_PX / 2,
        state.food.y * CELL_PX + CELL_PX / 2,
        CELL_PX / 2 - 2,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
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
      const progress = computeDifficultyProgress(Date.now() - startedAtMs, durationSeconds * 1000);
      // Note: this ramps DOWN (faster ticks as the window closes), unlike
      // every other game's speed/gap multiplier which ramps up — same
      // direction the original self-scheduling setTimeout used.
      const tickMs = computeDifficultyMultiplier(progress, TICK_MS_START, TICK_MS_MIN);
      accumulatorRef.current = Math.min(accumulatorRef.current + dt, tickMs * 10);

      let stepped = false;
      while (accumulatorRef.current >= tickMs) {
        gameRef.current = stepSnakeGame(gameRef.current, pendingDirectionRef.current);
        pendingDirectionRef.current = null;
        accumulatorRef.current -= tickMs;
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
      setHighScore(recordSnakeScore(gameRef.current.score));
    }
  }, [status]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const map: Record<string, Direction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        w: "up",
        s: "down",
        a: "left",
        d: "right",
      };
      const dir = map[e.key];
      if (dir) {
        e.preventDefault();
        pendingDirectionRef.current = dir;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX && Math.abs(dy) < SWIPE_THRESHOLD_PX) return;
    pendingDirectionRef.current =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    touchStartRef.current = null;
  }

  function handleRestart() {
    gameRef.current = createSnakeGame(GRID_SIZE);
    pendingDirectionRef.current = null;
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

      <div
        className="relative touch-none"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_PX}
          height={CANVAS_PX}
          className="max-w-full"
          style={{ width: CANVAS_PX, height: CANVAS_PX }}
          role="img"
          aria-label={`Snake mini-game, score ${score}`}
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

      <p className="font-body text-[11px] text-steel">Swipe or use arrow keys — purely optional.</p>
    </div>
  );
}
