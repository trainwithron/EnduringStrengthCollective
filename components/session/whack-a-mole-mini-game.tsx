"use client";

import { useEffect, useState } from "react";
import {
  createWhackAMoleGame,
  stepWhackAMoleTick,
  whackHole,
  HOLE_COUNT,
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
export function WhackAMoleMiniGame({
  onClose,
  startedAtMs,
  durationSeconds,
}: {
  onClose: () => void;
  startedAtMs: number;
  durationSeconds: number;
}) {
  const [gameState, setGameState] = useState<WhackAMoleState>(() => createWhackAMoleGame());
  const [highScore, setHighScore] = useState(0);

  useEffect(() => {
    setHighScore(readGameHighScore(GAME_KEY));
  }, []);

  useEffect(() => {
    if (gameState.status === "over") return;
    const interval = setInterval(() => {
      const progress = computeDifficultyProgress(Date.now() - startedAtMs, durationSeconds * 1000);
      const spawnIntervalMs = computeDifficultyMultiplier(progress, 900, 400);
      const moleUpMs = computeDifficultyMultiplier(progress, 1100, 550);
      setGameState((prev) => stepWhackAMoleTick(prev, TICK_MS, spawnIntervalMs, moleUpMs));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [gameState.status, startedAtMs, durationSeconds]);

  useEffect(() => {
    if (gameState.status === "over") {
      setHighScore(recordGameHighScore(GAME_KEY, gameState.score));
    }
  }, [gameState.status, gameState.score]);

  function handleWhack(holeIndex: number) {
    setGameState((prev) => whackHole(prev, holeIndex));
  }

  function handleRestart() {
    setGameState(createWhackAMoleGame());
  }

  const upHoles = new Set(gameState.moles.map((m) => m.holeIndex));

  return (
    <div className="mt-2 p-3 border border-steel/20 bg-graphite/60 flex flex-col items-center gap-2">
      <div className="w-full flex items-center justify-between font-body text-xs text-steel">
        <span>
          Score: <span className="text-chalk">{gameState.score}</span> · Best:{" "}
          <span className="text-chalk">{highScore}</span> · Misses:{" "}
          <span className="text-rust">{gameState.misses}</span>
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
        {gameState.status === "over" && (
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
