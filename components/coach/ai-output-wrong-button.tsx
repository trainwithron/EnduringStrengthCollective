"use client";

import { useState } from "react";
import { AI_REFUND_REASONS, type AiRefundAction } from "@/lib/ai-output-refund";

type Status = "idle" | "refunding" | "refunded" | "already-refunded" | "error";

// ai_output_foolproofing_and_quality_assurance_idea.md — one tap
// instantly refunds the credit, no gate, no explanation required
// (status flips to "refunded" immediately on success). The reason
// chips only ever appear AFTER that, as a genuinely optional follow-up
// — picking one (or skipping entirely) never affects whether the
// refund happened.
export function AiOutputWrongButton({ action, referenceId }: { action: AiRefundAction; referenceId: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [reasonSent, setReasonSent] = useState(false);
  const [customReason, setCustomReason] = useState("");

  async function flagWrong() {
    setStatus("refunding");
    try {
      const res = await fetch("/api/ai/refund-credit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, trigger: "coach_flagged", referenceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setStatus(data.refunded ? "refunded" : "already-refunded");
    } catch {
      setStatus("error");
    }
  }

  async function sendReason(reason: string) {
    if (reasonSent || !reason.trim()) return;
    setReasonSent(true);
    await fetch("/api/ai/refund-credit/reason", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referenceId, reason: reason.trim() }),
    }).catch(() => {});
  }

  if (status === "idle") {
    return (
      <button
        type="button"
        onClick={flagWrong}
        className="font-body text-xs text-steel underline underline-offset-2"
      >
        This was wrong — refund my credit
      </button>
    );
  }

  if (status === "refunding") {
    return <p className="font-body text-xs text-steel">Refunding…</p>;
  }

  if (status === "error") {
    return <p className="font-body text-xs text-rust">Couldn&apos;t refund — try again.</p>;
  }

  // "refunded" or "already-refunded" — either way the credit is back
  // (or already was from an earlier tap), so the UI reads the same.
  return (
    <div>
      <p className="font-body text-xs text-positive mb-2">✓ Credit refunded.</p>
      {!reasonSent && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-body text-[11px] text-steel mr-1">What went wrong? (optional)</span>
          {AI_REFUND_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => sendReason(r.label)}
              className="h-6 px-2 border border-steel/30 font-body text-[11px] text-chalk"
            >
              {r.label}
            </button>
          ))}
          <input
            type="text"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendReason(customReason);
            }}
            placeholder="Something else…"
            className="h-6 w-32 bg-transparent border border-steel/30 px-2 font-body text-[11px] text-chalk focus:outline-none"
          />
        </div>
      )}
      {reasonSent && <p className="font-body text-[11px] text-steel">Thanks — noted.</p>}
    </div>
  );
}
