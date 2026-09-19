"use client";

import { useState } from "react";

export function DispatchReplyForm({ replyToken }: { replyToken: string }) {
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/org-dispatch/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyToken, answer }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong — try again.");
        setSubmitting(false);
        return;
      }
      setSent(true);
    } catch {
      setError("Something went wrong — check your connection and try again.");
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <p className="font-body text-sm text-steel mt-6 text-center">
        Thanks — your answer was sent. Your original time is still being held.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-3">
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Your answer"
        rows={3}
        required
        className="w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
      />
      {error && (
        <p className="font-body text-xs text-rust text-center" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting || !answer.trim()}
        className="w-full h-11 bg-rust text-graphite font-display uppercase text-sm font-bold disabled:opacity-40"
      >
        {submitting ? "Sending…" : "Send answer"}
      </button>
    </form>
  );
}
