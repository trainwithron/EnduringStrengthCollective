"use client";

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";

// "Report a problem or suggest something". Captures the page and screen size automatically so a tester only has to say what
// went wrong. Variants: a small icon for the coach sidebar and a plain text link for settings pages.
export function FeedbackButton({ variant = "link" }: { variant?: "icon" | "link" }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"problem" | "idea">("problem");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!message.trim()) {
      setError("Write a few words first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          message,
          pagePath: window.location.pathname + window.location.search,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send that.");
      setDone(true);
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setDone(false);
    setError(null);
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Report a problem or suggest something"
          aria-label="Report a problem or suggest something"
          className="w-11 h-11 flex items-center justify-center text-steel active:text-chalk"
        >
          <MessageSquarePlus className="w-4 h-4" strokeWidth={2.25} />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="font-body text-sm font-bold text-rust">
          Report a problem or suggest something &rarr;
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Report a problem or suggest something"
          className="fixed inset-0 z-50 bg-graphite/80 flex items-end sm:items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-md bg-graphite border border-steel/30 p-5 text-chalk">
            {done ? (
              <>
                <p className="font-display uppercase font-bold text-xl">Thank you</p>
                <p className="font-body text-sm text-steel mt-2">
                  We got it, along with the page you were on. We read every one.
                </p>
                <button type="button" onClick={close} className="mt-4 h-11 w-full bg-rust text-graphite font-display uppercase font-bold">
                  Close
                </button>
              </>
            ) : (
              <>
                <p className="font-display uppercase font-bold text-xl">Tell us</p>
                <div className="flex gap-2 mt-3" role="radiogroup" aria-label="What kind of note">
                  {(["problem", "idea"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      onClick={() => setKind(k)}
                      className={`h-9 px-3 font-body text-sm border ${kind === k ? "border-rust text-chalk" : "border-steel/30 text-steel"}`}
                    >
                      {k === "problem" ? "Something is wrong" : "I have an idea"}
                    </button>
                  ))}
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  maxLength={4000}
                  placeholder={kind === "problem" ? "What happened, and what did you expect?" : "What would make this better for you?"}
                  className="w-full mt-3 bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-base focus:outline-none focus:border-rust"
                />
                <p className="font-body text-xs text-steel mt-1">We attach the page you are on and your screen size.</p>
                {error && (
                  <p className="font-body text-sm text-rust mt-2" role="alert">
                    {error}
                  </p>
                )}
                <div className="flex gap-2 mt-4">
                  <button type="button" onClick={close} className="h-11 px-4 border border-steel/30 font-body text-sm text-steel">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={send}
                    disabled={busy}
                    className="h-11 flex-1 bg-rust text-graphite font-display uppercase font-bold disabled:opacity-40"
                  >
                    {busy ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
