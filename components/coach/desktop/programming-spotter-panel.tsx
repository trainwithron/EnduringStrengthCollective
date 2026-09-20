"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SpotterFlag } from "@/lib/programming-spotter-gather";

// Programming Spotter — reviews a program's own structure before anyone
// logs a rep against it. Deliberately every headline is phrased as a
// question, never an assertion (the evidence behind these checks doesn't
// support a hard "this is wrong" claim) — same governing fact-vs-question
// rule as the rest of the Collective Intelligence work.
//
// Confirm/Deny/Edit (spotter_suggestive_only_top3_confirm_deny_edit_
// principle_sept19.md): the coach is the ultimate QA, never a rubber
// stamp on one AI guess. Confirm/Edit don't persist a dismissal — there's
// no mechanized action a finding here leads to, so both just acknowledge
// for this view; only Deny persists (same escalating-suppress-after-2
// mechanism this panel already had). A flag that's been denied/edited 3
// of the last 5 times it fired gets a one-tap "stop suggesting this"
// card instead of the normal three actions.
export function ProgrammingSpotterPanel({ programId, flags }: { programId: string; flags: SpotterFlag[] }) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [condition, setCondition] = useState("");
  const [preference, setPreference] = useState("");
  const [ignoredStopPrompt, setIgnoredStopPrompt] = useState<Set<string>>(new Set());

  const visible = flags.filter((f) => !handled.has(`${f.checkKind}::${f.patternKey}`));
  if (visible.length === 0) return null;

  async function sendFeedback(flag: SpotterFlag, action: "confirmed" | "denied" | "edited", extra?: { condition: string; preference: string }) {
    const key = `${flag.checkKind}::${flag.patternKey}`;
    setBusyKey(key);
    try {
      await fetch("/api/programming-spotter/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          programId,
          checkKind: flag.checkKind,
          patternKey: flag.patternKey,
          headline: flag.headline,
          action,
          condition: extra?.condition,
          preference: extra?.preference,
        }),
      });
      setHandled((prev) => new Set(prev).add(key));
      setEditingKey(null);
      setCondition("");
      setPreference("");
      if (action === "denied") router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function handleStopSuggesting(flag: SpotterFlag) {
    const key = `${flag.checkKind}::${flag.patternKey}`;
    setBusyKey(key);
    try {
      await fetch("/api/programming-spotter/stop-suggesting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ programId, checkKind: flag.checkKind, patternKey: flag.patternKey }),
      });
      setHandled((prev) => new Set(prev).add(key));
      router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="border border-steel/20 bg-surface px-4 py-3 mb-4">
      <p className="font-body text-[11px] text-steel uppercase tracking-wide font-bold mb-2">
        Programming Spotter
      </p>
      <div className="space-y-3">
        {visible.map((flag) => {
          const key = `${flag.checkKind}::${flag.patternKey}`;
          const busy = busyKey === key;
          const showStopPrompt = flag.promptStopSuggesting && !ignoredStopPrompt.has(key);

          if (showStopPrompt) {
            return (
              <div key={key} className="border border-rust/30 bg-rust/5 px-3 py-2">
                <p className="font-body text-sm text-chalk mb-2">
                  You&apos;ve said no to this kind of suggestion a few times — stop recommending it for this program?
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleStopSuggesting(flag)}
                    disabled={busy}
                    className="font-body text-[11px] text-rust uppercase tracking-wide font-bold disabled:opacity-40"
                  >
                    Yes, stop showing this
                  </button>
                  <button
                    type="button"
                    onClick={() => setIgnoredStopPrompt((prev) => new Set(prev).add(key))}
                    disabled={busy}
                    className="font-body text-[11px] text-steel uppercase tracking-wide disabled:opacity-40"
                  >
                    No, keep showing me these
                  </button>
                </div>
              </div>
            );
          }

          if (editingKey === key) {
            return (
              <div key={key} className="border border-steel/20 px-3 py-2">
                <p className="font-body text-sm text-chalk mb-2">{flag.headline}</p>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    placeholder="When... (e.g. legs takes up the back half of a session)"
                    className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
                  />
                  <input
                    type="text"
                    value={preference}
                    onChange={(e) => setPreference(e.target.value)}
                    placeholder="...do this instead (e.g. that's intentional, don't flag it)"
                    className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => sendFeedback(flag, "edited", { condition, preference })}
                      disabled={busy || !condition.trim() || !preference.trim()}
                      className="font-body text-[11px] text-rust uppercase tracking-wide font-bold disabled:opacity-40"
                    >
                      Save preference
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingKey(null)}
                      disabled={busy}
                      className="font-body text-[11px] text-steel uppercase tracking-wide disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={key} className="flex items-start gap-2">
              <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0 bg-steel" />
              <p className="font-body text-sm text-chalk flex-1">{flag.headline}</p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => sendFeedback(flag, "confirmed")}
                  disabled={busy}
                  className="font-body text-[11px] text-steel uppercase tracking-wide active:text-chalk disabled:opacity-40"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setEditingKey(key)}
                  disabled={busy}
                  className="font-body text-[11px] text-steel uppercase tracking-wide active:text-chalk disabled:opacity-40"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => sendFeedback(flag, "denied")}
                  disabled={busy}
                  className="font-body text-[11px] text-steel uppercase tracking-wide active:text-rust disabled:opacity-40"
                >
                  Deny
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
