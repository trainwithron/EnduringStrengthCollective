"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DispatchStepActions({ stepId }: { stepId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askingQuestion, setAskingQuestion] = useState(false);
  const [question, setQuestion] = useState("");
  const router = useRouter();

  async function respond(action: "accept" | "decline") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/org-dispatch/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong — try again.");
      return;
    }
    router.refresh();
  }

  async function submitQuestion() {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/org-dispatch/ask-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId, question }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong — try again.");
      return;
    }
    setQuestion("");
    setAskingQuestion(false);
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-3">
      {error && (
        <p className="font-body text-xs text-rust text-center" role="alert">
          {error}
        </p>
      )}

      {askingQuestion ? (
        <div className="space-y-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Could they potentially do a different day?"
            rows={2}
            className="w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitQuestion}
              disabled={busy || !question.trim()}
              className="flex-1 h-11 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {busy ? "Sending…" : "Send question"}
            </button>
            <button
              type="button"
              onClick={() => setAskingQuestion(false)}
              disabled={busy}
              className="h-11 px-4 border border-steel/30 text-steel font-body text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => respond("accept")}
            disabled={busy}
            className="w-full h-12 bg-rust text-graphite font-display uppercase text-sm font-bold disabled:opacity-40"
          >
            {busy ? "Working…" : "Accept"}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => respond("decline")}
              disabled={busy}
              className="flex-1 h-11 border border-steel/30 text-steel font-body text-sm disabled:opacity-40"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => setAskingQuestion(true)}
              disabled={busy}
              className="flex-1 h-11 border border-steel/30 text-steel font-body text-sm disabled:opacity-40"
            >
              Ask a question
            </button>
          </div>
        </>
      )}
    </div>
  );
}
