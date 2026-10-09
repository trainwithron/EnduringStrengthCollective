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
  // With several suggestions the panel is one summary line; the list opens on Review.
  const [expanded, setExpanded] = useState(false);

  const visible = flags.filter((f) => !handled.has(`${f.checkKind}::${f.patternKey}`));
  if (visible.length === 0) return null;

  // Real ask from Ron: a bulk way to dismiss everything pending at once
  // instead of working through each individually. Deliberately local-only
  // (no /api/programming-spotter/feedback call, no deny-pattern tracking)
  // — a bulk clear isn't an intentional judgment on any one suggestion the
  // way a real per-item Confirm/Deny is, so it shouldn't feed the same
  // escalating-suppress mechanism a real Deny does. These clear again
  // next time this Spotter actually re-runs and re-finds them.
  function handleClearAll() {
    setHandled((prev) => {
      const next = new Set(prev);
      for (const f of visible) next.add(`${f.checkKind}::${f.patternKey}`);
      return next;
    });
  }

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
    <div className="border border-rust/40 bg-rust/5 px-4 py-3 mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="font-body text-xs text-rust uppercase tracking-wide font-bold">
          Programming Spotter
        </p>
        {visible.length > 1 && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="font-body text-xs text-rust uppercase tracking-wide font-bold"
            >
              {expanded ? "Hide" : "Review"}
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="font-body text-xs text-steel uppercase tracking-wide active:text-chalk"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
      {visible.length > 1 && !expanded && (
        <p className="font-body text-sm text-chalk">{visible.length} things in this program are worth a look.</p>
      )}
      <div className={visible.length > 1 && !expanded ? "hidden" : "space-y-3"}>
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
                    className="font-body text-xs text-rust uppercase tracking-wide font-bold disabled:opacity-40"
                  >
                    Yes, stop showing this
                  </button>
                  <button
                    type="button"
                    onClick={() => setIgnoredStopPrompt((prev) => new Set(prev).add(key))}
                    disabled={busy}
                    className="font-body text-xs text-steel uppercase tracking-wide disabled:opacity-40"
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
                      className="font-body text-xs text-rust uppercase tracking-wide font-bold disabled:opacity-40"
                    >
                      Save preference
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingKey(null)}
                      disabled={busy}
                      className="font-body text-xs text-steel uppercase tracking-wide disabled:opacity-40"
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
                  className="font-body text-xs text-moss uppercase tracking-wide disabled:opacity-40"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setEditingKey(key)}
                  disabled={busy}
                  className="font-body text-xs text-steel uppercase tracking-wide active:text-chalk disabled:opacity-40"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => sendFeedback(flag, "denied")}
                  disabled={busy}
                  className="font-body text-xs text-rust uppercase tracking-wide font-bold disabled:opacity-40"
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
