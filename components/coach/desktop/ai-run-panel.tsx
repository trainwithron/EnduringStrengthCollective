"use client";

import { useState } from "react";
import { readAiJson } from "@/lib/ai-fetch";

// Beside the AI Program Builder: what the coach asked for in this run (their request and every change they asked for, read-only, collapsible) so they can compare it with what they got, and an
// "Ask why" box under it. The answer only explains; it never changes the program.
export function AiRunPanel({ programId, request, corrections }: { programId: string; request: string; corrections: string[] }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!request) return null;

  async function explain() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/explain-program", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ programId, question: q, request, corrections }),
      });
      const data = await readAiJson(res);
      if (!res.ok || typeof data.answer !== "string") {
        setError((data.error as string | undefined) ?? "Couldn't answer that. Try again.");
      } else {
        setAnswer(data.answer);
      }
    } catch {
      setError("Couldn't answer that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="w-full lg:w-80 shrink-0 border border-steel/25 bg-surface/40 p-3" aria-label="What you asked for">
      <details open>
        <summary className="font-display uppercase text-sm tracking-wide text-steel cursor-pointer min-h-9 flex items-center">What you asked for</summary>
        <p className="font-body text-sm text-chalk whitespace-pre-wrap break-words mt-2">{request}</p>
        {corrections.length > 0 && (
          <div className="mt-3">
            <p className="font-body text-xs text-steel uppercase tracking-wide">Changes you asked for</p>
            <ol className="mt-1 space-y-1 list-decimal list-inside">
              {corrections.map((c, i) => (
                <li key={i} className="font-body text-sm text-chalk break-words">
                  {c}
                </li>
              ))}
            </ol>
          </div>
        )}
      </details>
      <div className="mt-4 border-t border-steel/20 pt-3">
        <label className="block font-body text-xs text-steel uppercase tracking-wide" htmlFor="ai-ask-why">
          Ask why
        </label>
        <textarea
          id="ai-ask-why"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Ask why it did something, for example: why two presses on Day 1?"
          className="mt-1 w-full bg-graphite border border-steel/30 text-chalk px-2 py-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
        />
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={() => void explain()} disabled={!question.trim() || busy} className="min-h-11 px-5 border border-rust text-rust font-display font-bold uppercase tracking-wide disabled:opacity-40">
            {busy ? "One moment…" : "Explain"}
          </button>
          <p className="font-body text-xs text-steel">It only explains. It changes nothing unless you ask.</p>
        </div>
        {answer && (
          <p className="font-body text-sm text-chalk whitespace-pre-wrap break-words mt-3" role="status">
            {answer}
          </p>
        )}
        {error && (
          <p className="font-body text-xs text-rust mt-2" role="alert">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
