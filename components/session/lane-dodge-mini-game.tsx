"use client";

import { useEffect, useRef, useState } from "react";
import {
  createLaneDodgeGame,
  stepLaneDodgeGame,
  LANE_COUNT,
  BOARD_HEIGHT,
  PLAYER_Y,
  PLAYER_HEIGHT,
  OBSTACLE_HEIGHT,
  type LaneDodgeState,
} from "@/lib/lane-dodge-game";
import { computeDifficultyProgress, computeDifficultyMultiplier } from "@/lib/rest-timer-difficulty";
import { readGameHighScore, recordGameHighScore } from "@/lib/rest-timer-high-score";

const GAME_KEY = "lane-dodge";
const BOARD_WIDTH = 210;
const LANE_WIDTH = BOARD_WIDTH / LANE_COUNT;
const TICK_MS = 40;
const SWIPE_THRESHOLD_PX = 20;
const RUST = "#D2703B";
const GRAPHITE = "#1C1B1A";
const STEEL = "#908B7E";

// Rest-timer mini-game library, lane-dodge entry (Phase 4,
// custom_shape_theming_idea.md) — swipe/tap left-right to switch lanes;
// fall speed and obstacle density ramp against real elapsed rest time.
export function LaneDodgeMiniGame({
  onClose,
  startedAtMs,
  durationSeconds,
}: {
  onClose: () => void;
  startedAtMs: number;
  durationSeconds: number;
}) {
  const [gameState, setGameState] = useState<LaneDodgeState>(() => createLaneDodgeGame());
  const [highScore, setHighScore] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const laneChangeRef = useRef<-1 | 1 | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setHighScore(readGameHighScore(GAME_KEY));
  }, []);

  useEffect(() => {
    if (gameState.status === "over") return;
    const interval = setInterval(() => {
      const progress = computeDifficultyProgress(Date.now() - startedAtMs, durationSeconds * 1000);
      const scrollSpeed = computeDifficultyMultiplier(progress, 3, 8);
      const spawnGapPx = computeDifficultyMultiplier(progress, 160, 80);
      setGameState((prev) => stepLaneDodgeGame(prev, laneChangeRef.current, scrollSpeed, spawnGapPx));
      laneChangeRef.current = null;
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
    for (let i = 1; i < LANE_COUNT; i++) {
      ctx.beginPath();
      ctx.moveTo(i * LANE_WIDTH, 0);
      ctx.lineTo(i * LANE_WIDTH, BOARD_HEIGHT);
      ctx.stroke();
    }
    ctx.fillStyle = STEEL;
    for (const o of gameState.obstacles) {
      ctx.fillRect(o.lane * LANE_WIDTH + 4, o.y, LANE_WIDTH - 8, OBSTACLE_HEIGHT);
    }
    ctx.fillStyle = RUST;
    ctx.fillRect(gameState.playerLane * LANE_WIDTH + 4, PLAYER_Y, LANE_WIDTH - 8, PLAYER_HEIGHT);
  }, [gameState]);

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    laneChangeRef.current = dx > 0 ? 1 : -1;
    touchStartRef.current = null;
  }

  function handleRestart() {
    setGameState(createLaneDodgeGame());
    laneChangeRef.current = null;
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
      <div className="relative touch-none" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <canvas
          ref={canvasRef}
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
          className="max-w-full"
          style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}
          role="img"
          aria-label={`Lane dodge mini-game, score ${gameState.score}`}
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
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => (laneChangeRef.current = -1)}
          className="h-8 px-4 border border-steel/30 text-steel font-body text-xs"
        >
          ← Left
        </button>
        <button
          type="button"
          onClick={() => (laneChangeRef.current = 1)}
          className="h-8 px-4 border border-steel/30 text-steel font-body text-xs"
        >
          Right →
        </button>
      </div>
      <p className="font-body text-[11px] text-steel">Swipe or tap left/right — purely optional.</p>
    </div>
  );
}
