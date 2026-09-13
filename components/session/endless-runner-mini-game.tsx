"use client";

import { useEffect, useRef, useState } from "react";
import {
  createRunnerGame,
  stepRunnerGame,
  BOARD_WIDTH,
  PLAYER_X,
  PLAYER_WIDTH,
  OBSTACLE_WIDTH,
  GROUND_Y,
  type RunnerGameState,
} from "@/lib/endless-runner-game";
import { computeDifficultyProgress, computeDifficultyMultiplier } from "@/lib/rest-timer-difficulty";
import { readGameHighScore, recordGameHighScore } from "@/lib/rest-timer-high-score";

const GAME_KEY = "runner";
const BOARD_HEIGHT = 160;
const GROUND_PX = 130; // canvas y of the ground line
const TICK_MS = 30;
const RUST = "#D2703B";
const GRAPHITE = "#1C1B1A";
const STEEL = "#908B7E";

// Rest-timer mini-game library, endless-runner entry (Phase 4,
// custom_shape_theming_idea.md) — one tap to jump, obstacle frequency
// and scroll speed ramp against real elapsed rest time.
export function EndlessRunnerMiniGame({
  onClose,
  startedAtMs,
  durationSeconds,
}: {
  onClose: () => void;
  startedAtMs: number;
  durationSeconds: number;
}) {
  const [gameState, setGameState] = useState<RunnerGameState>(() => createRunnerGame());
  const [highScore, setHighScore] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const jumpRequestedRef = useRef(false);

  useEffect(() => {
    setHighScore(readGameHighScore(GAME_KEY));
  }, []);

  useEffect(() => {
    if (gameState.status === "over") return;
    const interval = setInterval(() => {
      const progress = computeDifficultyProgress(Date.now() - startedAtMs, durationSeconds * 1000);
      const scrollSpeed = computeDifficultyMultiplier(progress, 2.5, 6);
      const obstacleGap = computeDifficultyMultiplier(progress, 160, 90);
      setGameState((prev) => stepRunnerGame(prev, jumpRequestedRef.current, scrollSpeed, obstacleGap));
      jumpRequestedRef.current = false;
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
    ctx.strokeStyle = STEEL;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_PX);
    ctx.lineTo(BOARD_WIDTH, GROUND_PX);
    ctx.stroke();
    ctx.fillStyle = STEEL;
    for (const o of gameState.obstacles) {
      ctx.fillRect(o.x, GROUND_PX - 18, OBSTACLE_WIDTH, 18);
    }
    ctx.fillStyle = RUST;
    const playerCanvasY = GROUND_PX - 20 + (gameState.playerY - GROUND_Y);
    ctx.fillRect(PLAYER_X, playerCanvasY, PLAYER_WIDTH, 20);
  }, [gameState]);

  function handleJump() {
    jumpRequestedRef.current = true;
  }

  function handleRestart() {
    setGameState(createRunnerGame());
    jumpRequestedRef.current = false;
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
      <div className="relative touch-none" onPointerDown={handleJump}>
        <canvas
          ref={canvasRef}
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
          className="max-w-full"
          style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}
          role="img"
          aria-label={`Endless runner mini-game, score ${gameState.score}`}
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
      <p className="font-body text-[11px] text-steel">Tap to jump — purely optional.</p>
    </div>
  );
}
