"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface TriviaQuestionRow {
  id: string;
  statement: string;
  correctAnswer: boolean;
  status: "pending" | "approved" | "rejected";
}

// AI drafts, a platform admin approves -- the real correctness gate
// before a question ever reaches a live trivia round (a question has
// one factually correct answer, so a wrong AI-hallucinated fact would
// be a genuine bug, not just a taste miss).
export function TriviaReviewPanel({ initialQuestions }: { initialQuestions: TriviaQuestionRow[] }) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(id: string, status: "approved" | "rejected") {
    const supabase = createBrowserClient();
    await supabase.from("trivia_questions").update({ status }).eq("id", id);
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/trivia/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 10 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't generate questions.");
        return;
      }
      const supabase = createBrowserClient();
      const { data: pending } = await supabase
        .from("trivia_questions")
        .select("id, statement, correct_answer, status")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      setQuestions(
        (pending ?? []).map((q) => ({
          id: q.id,
          statement: q.statement,
          correctAnswer: q.correct_answer,
          status: q.status as "pending",
        }))
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="h-9 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40 mb-4"
      >
        {generating ? "Generating…" : "Generate 10 more with AI"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mb-3" role="alert">
          {error}
        </p>
      )}
      {questions.length === 0 ? (
        <p className="font-body text-sm text-steel">No pending questions to review.</p>
      ) : (
        <div className="space-y-2">
          {questions.map((q) => (
            <div key={q.id} className="border border-steel/20 p-3 flex items-start justify-between gap-3">
              <div>
                <p className="font-body text-sm text-chalk">{q.statement}</p>
                <p className="font-body text-[11px] text-steel mt-1 uppercase tracking-wide">
                  Marked: {q.correctAnswer ? "True" : "False"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setStatus(q.id, "approved")}
                  className="h-8 px-2.5 bg-rust text-graphite font-body text-xs font-medium"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(q.id, "rejected")}
                  className="h-8 px-2.5 border border-steel/30 text-steel font-body text-xs"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
