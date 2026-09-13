"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { createTriviaRound, answerTrivia, type TriviaRoundState } from "@/lib/trivia-round";

const SWIPE_THRESHOLD_PX = 60;

// Trivia flash-round (custom_shape_theming_idea.md) — a distinct rest-
// timer activity alongside the arcade mini-game library: swipe right
// for True, left for False, answer as many as you can before rest ends.
// Fetches the live, admin-approved question bank once on mount (RLS
// already scopes this to status = 'approved' — never a pending/AI-
// unreviewed question).
export function TriviaMiniGame({ onClose }: { onClose: () => void }) {
  const [round, setRound] = useState<TriviaRoundState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const dragStartRef = useRef<{ x: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("trivia_questions")
        .select("id, statement, correct_answer")
        .eq("status", "approved");
      if (cancelled) return;
      if (!data || data.length === 0) {
        setLoadError(true);
        return;
      }
      setRound(
        createTriviaRound(data.map((q) => ({ id: q.id, statement: q.statement, correctAnswer: q.correct_answer })))
      );
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleAnswer(answer: boolean) {
    setRound((prev) => (prev ? answerTrivia(prev, answer) : prev));
    setSwipeOffset(0);
  }

  function handlePointerDown(e: React.PointerEvent) {
    dragStartRef.current = { x: e.clientX };
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragStartRef.current) return;
    setSwipeOffset(e.clientX - dragStartRef.current.x);
  }
  function handlePointerUp() {
    if (!dragStartRef.current) return;
    if (Math.abs(swipeOffset) > SWIPE_THRESHOLD_PX) {
      handleAnswer(swipeOffset > 0);
    } else {
      setSwipeOffset(0);
    }
    dragStartRef.current = null;
  }

  if (loadError) {
    return (
      <div className="mt-2 p-3 border border-steel/20 bg-graphite/60">
        <p className="font-body text-xs text-steel">
          Trivia isn&apos;t ready yet — no questions in the bank.
        </p>
        <button type="button" onClick={onClose} className="font-body text-xs text-rust mt-2">
          Close
        </button>
      </div>
    );
  }

  if (!round) {
    return (
      <div className="mt-2 p-3 border border-steel/20 bg-graphite/60">
        <p className="font-body text-xs text-steel">Loading…</p>
      </div>
    );
  }

  const current = round.questions[round.currentIndex];

  return (
    <div className="mt-2 p-3 border border-steel/20 bg-graphite/60 flex flex-col items-center gap-3">
      <div className="w-full flex items-center justify-between font-body text-xs text-steel">
        <span>
          Score: <span className="text-chalk">{round.score}</span> / {round.answered}
        </span>
        <button type="button" onClick={onClose} className="text-steel active:text-rust transition-colors">
          Close ✕
        </button>
      </div>

      <div
        className="w-full max-w-[280px] h-40 border border-steel/30 bg-surface flex items-center justify-center p-4 select-none touch-none cursor-grab"
        style={{ transform: `translateX(${swipeOffset}px) rotate(${swipeOffset / 20}deg)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <p className="font-body text-sm text-chalk text-center">{current?.statement}</p>
      </div>

      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={() => handleAnswer(false)}
          className="h-10 px-5 border border-rust/50 text-rust font-body text-sm font-medium"
        >
          ← False
        </button>
        <button
          type="button"
          onClick={() => handleAnswer(true)}
          className="h-10 px-5 bg-rust text-graphite font-body text-sm font-medium"
        >
          True →
        </button>
      </div>
      <p className="font-body text-[11px] text-steel">Swipe or tap — purely optional.</p>
    </div>
  );
}
