"use client";

import { useState } from "react";
import { MicButton } from "@/components/shared/mic-button";

type Step = "ask" | "why" | "readback" | "done" | "gone";

async function post(url: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: {} };
  }
}

// The one quiet question after a sign-off: "you keep changing X to Y, use Y from now on?". Small and grey, never a popup, ignorable (leaving it alone changes nothing and it is
// never asked again). Yes saves a standing preference the builder uses; an optional "tell me why" turns the coach's reason into one plain sentence that is read back before
// it is saved. Everything can be undone from "What I've learned about how you coach".
export function LearnedSuggestionCard({ ruleId, text }: { ruleId: string; text: string }) {
  const [step, setStep] = useState<Step>("ask");
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const [ruleText, setRuleText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function answer(action: "yes" | "no") {
    setBusy(true);
    setError(null);
    const r = await post(`/api/learned-rules/${ruleId}`, { action });
    setBusy(false);
    if (!r.ok) {
      setError(r.data?.error ?? "That didn't save. Try again.");
      return;
    }
    setStep(action === "yes" ? "why" : "gone");
  }

  async function sendWhy() {
    if (!why.trim()) return;
    setBusy(true);
    setError(null);
    const r = await post("/api/ai/learn-reason", { ruleId, reason: why });
    setBusy(false);
    if (!r.ok) {
      setError(r.data?.error ?? "I couldn't turn that into a rule. Try again, or skip.");
      return;
    }
    setRuleText(r.data.ruleText);
    setStep("readback");
  }

  async function saveReason() {
    setBusy(true);
    const r = await post(`/api/learned-rules/${ruleId}`, { action: "reason", reason: why, ruleText });
    setBusy(false);
    if (!r.ok) {
      setError(r.data?.error ?? "That didn't save. Try again.");
      return;
    }
    setStep("done");
  }

  async function undo() {
    setBusy(true);
    const r = await post(`/api/learned-rules/${ruleId}`, { action: "undo" });
    setBusy(false);
    if (r.ok) setStep("gone");
  }

  if (step === "gone") return null;
  const small = "min-h-11 px-3 font-body text-sm border border-steel/30 text-steel hover:text-chalk disabled:opacity-40";
  return (
    <div className="mb-4 border border-steel/20 bg-surface/40 p-3 font-body text-sm text-steel max-w-2xl" role="status">
      {step === "ask" && (
        <>
          <p>{text}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={small} disabled={busy} onClick={() => answer("yes")}>
              Yes
            </button>
            <button type="button" className={small} disabled={busy} onClick={() => answer("no")}>
              No
            </button>
          </div>
        </>
      )}
      {step === "why" && (
        <>
          <p className="text-chalk">Saved. I&apos;ll use it when I build your programs.</p>
          <p className="mt-2 text-xs">Tell me why, so I can build it your way next time. You can skip this.</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              maxLength={600}
              aria-label="Why did you change it?"
              placeholder="Why did you change it?"
              className="flex-1 min-w-48 h-11 bg-transparent border border-steel/25 px-2 text-chalk text-sm"
            />
            <MicButton onText={(t) => setWhy((w) => (w ? `${w} ${t}` : t))} />
            <button type="button" className={small} disabled={busy || !why.trim()} onClick={sendWhy}>
              Send
            </button>
            <button type="button" className="min-h-11 px-2 text-xs underline" onClick={() => setStep("done")}>
              Skip
            </button>
          </div>
        </>
      )}
      {step === "readback" && (
        <>
          <p>
            I&apos;ll remember: <span className="text-chalk">{ruleText}</span>
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={small} disabled={busy} onClick={saveReason}>
              Save
            </button>
            <button type="button" className={small} disabled={busy} onClick={() => setStep("done")}>
              No thanks
            </button>
          </div>
        </>
      )}
      {step === "done" && (
        <p>
          Saved. You can undo it any time under What I&apos;ve learned about how you coach.{" "}
          <button type="button" className="underline" disabled={busy} onClick={undo}>
            Undo now
          </button>
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
