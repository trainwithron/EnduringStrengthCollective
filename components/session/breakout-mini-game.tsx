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
export function BreakoutMiniGame({
  onClose,
  startedAtMs,
  durationSeconds,
}: {
  onClose: () => void;
  startedAtMs: number;
  durationSeconds: number;
}) {
  const [gameState, setGameState] = useState<BreakoutState>(() => createBreakoutGame());
  const [highScore, setHighScore] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paddleTargetRef = useRef(BOARD_WIDTH / 2);

  useEffect(() => {
    setHighScore(readGameHighScore(GAME_KEY));
  }, []);

  useEffect(() => {
    if (gameState.status === "over") return;
    const interval = setInterval(() => {
      const progress = computeDifficultyProgress(Date.now() - startedAtMs, durationSeconds * 1000);
      const speedMultiplier = computeDifficultyMultiplier(progress, 1, 2.2);
      setGameState((prev) => stepBreakoutGame(prev, paddleTargetRef.current, speedMultiplier));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [gameState.status, startedAtMs, durationSeconds]);

  useEffect(() => {
    if (gameState.status === "over") {
      setHighScore(recordGameHighScore(GAME_KEY, gameState.score));
    }
  }, [gameState.status, gameState.score]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = GRAPHITE;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.fillStyle = STEEL;
    for (const b of gameState.bricks) {
      if (!b.alive) continue;
      ctx.fillRect(b.col * BRICK_WIDTH + 1, BRICK_TOP + b.row * BRICK_HEIGHT + 1, BRICK_WIDTH - 2, BRICK_HEIGHT - 2);
    }
    ctx.fillStyle = RUST;
    ctx.fillRect(gameState.paddleX - PADDLE_WIDTH / 2, PADDLE_Y, PADDLE_WIDTH, PADDLE_HEIGHT);
    ctx.fillStyle = CHALK;
    ctx.beginPath();
    ctx.arc(gameState.ballX, gameState.ballY, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }, [gameState]);

  function updatePaddleFromClientX(clientX: number, rect: DOMRect) {
    const scale = BOARD_WIDTH / rect.width;
    paddleTargetRef.current = (clientX - rect.left) * scale;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    updatePaddleFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
  }

  function handleRestart() {
    setGameState(createBreakoutGame());
    paddleTargetRef.current = BOARD_WIDTH / 2;
  }

  return (
    <div className="mt-2 p-3 border border-steel/20 bg-graphite/60 flex flex-col items-center gap-2">
      <div className="w-full flex items-center justify-between font-body text-xs text-steel">
        <span>
          Score: <span className="text-chalk">{gameState.score}</span> · Best:{" "}
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
          aria-label={`Brick breaker mini-game, score ${gameState.score}`}
        />
        {gameState.status === "over" && (
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
