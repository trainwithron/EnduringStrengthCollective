"use client";

import { useEffect, useRef, useState } from "react";
import {
  createBreakoutGame,
  stepBreakoutGame,
  BOARD_WIDTH,
  BOARD_HEIGHT,
  PADDLE_WIDTH,
  PADDLE_Y,
  PADDLE_HEIGHT,
  BALL_RADIUS,
  BRICK_WIDTH,
  BRICK_HEIGHT,
  BRICK_TOP,
  type BreakoutState,
} from "@/lib/breakout-game";
import { computeDifficultyProgress, computeDifficultyMultiplier } from "@/lib/rest-timer-difficulty";
import { readGameHighScore, recordGameHighScore } from "@/lib/rest-timer-high-score";

const GAME_KEY = "breakout";
const TICK_MS = 30;
const RUST = "#D2703B";
const CHALK = "#EDE8E0";
const GRAPHITE = "#1C1B1A";
const STEEL = "#908B7E";

// Rest-timer mini-game library, brick-breaker entry (Phase 4,
// custom_shape_theming_idea.md) — "ball speed increases the longer it
// survives," driven by the shared difficulty ramp against real elapsed
// rest time. Drag/touch the paddle to steer.
//
// Physics loop runs via requestAnimationFrame driving a ref-held game
// state, with the canvas drawn imperatively inside that same callback —
// not the old setInterval+setState loop, which forced a full React
// re-render every 30ms for as long as the game panel was open (see
// rest_timer_minigame_performance_investigation.md). A time-accumulator
// steps the pure `stepBreakoutGame` reducer at the exact same fixed
// 30ms cadence as before regardless of the browser's actual frame rate,
// so difficulty ramp/ball speed feel identical to the prior version.
// React state is reserved for score/status only — the two things the
// JSX actually needs to react to.
export function BreakoutMiniGame({
  onClose,
  startedAtMs,
  durationSeconds,
}: {
  onClose: () => void;
  startedAtMs: number;
  durationSeconds: number;
}) {
  const gameRef = useRef<BreakoutState>(createBreakoutGame());
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState<"playing" | "over">("playing");
  const [highScore, setHighScore] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paddleTargetRef = useRef(BOARD_WIDTH / 2);
  const rafRef = useRef<number | null>(null);
  const accumulatorRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setHighScore(readGameHighScore(GAME_KEY));
  }, []);

  function draw(state: BreakoutState) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = GRAPHITE;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.fillStyle = STEEL;
    for (const b of state.bricks) {
      if (!b.alive) continue;
      ctx.fillRect(b.col * BRICK_WIDTH + 1, BRICK_TOP + b.row * BRICK_HEIGHT + 1, BRICK_WIDTH - 2, BRICK_HEIGHT - 2);
    }
    ctx.fillStyle = RUST;
    ctx.fillRect(state.paddleX - PADDLE_WIDTH / 2, PADDLE_Y, PADDLE_WIDTH, PADDLE_HEIGHT);
    ctx.fillStyle = CHALK;
    ctx.beginPath();
    ctx.arc(state.ballX, state.ballY, BALL_RADIUS, 0, Math.PI * 2);
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
      // Clamp a huge dt (tab backgrounded, then foregrounded) so the
      // fixed-timestep loop below doesn't try to catch up hundreds of
      // ticks at once.
      accumulatorRef.current = Math.min(accumulatorRef.current + dt, TICK_MS * 10);

      let stepped = false;
      while (accumulatorRef.current >= TICK_MS) {
        const progress = computeDifficultyProgress(Date.now() - startedAtMs, durationSeconds * 1000);
        const speedMultiplier = computeDifficultyMultiplier(progress, 1, 2.2);
        gameRef.current = stepBreakoutGame(gameRef.current, paddleTargetRef.current, speedMultiplier);
        accumulatorRef.current -= TICK_MS;
        stepped = true;
        if (gameRef.current.status === "over") break;
      }

      draw(gameRef.current);

      if (stepped) {
        setScore(gameRef.current.score);
        if (gameRef.current.status === "over") {
          setStatus("over");
          return; // don't schedule another frame — the effect re-runs when status changes
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

  function updatePaddleFromClientX(clientX: number, rect: DOMRect) {
    const scale = BOARD_WIDTH / rect.width;
    paddleTargetRef.current = (clientX - rect.left) * scale;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    updatePaddleFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
  }

  function handleRestart() {
    gameRef.current = createBreakoutGame();
    paddleTargetRef.current = BOARD_WIDTH / 2;
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
        onPointerDown={handlePointerMove}
        onPointerMove={handlePointerMove}
      >
        <canvas
          ref={canvasRef}
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
          className="max-w-full"
          style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}
          role="img"
          aria-label={`Brick breaker mini-game, score ${score}`}
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
      <p className="font-body text-[11px] text-steel">Drag to move the paddle — purely optional.</p>
    </div>
  );
}
