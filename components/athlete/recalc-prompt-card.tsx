"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { answerRow, MAX_ANSWER_TEXT } from "@/lib/recalc-prompt";

// "Are you happy with your meal plan?", asked once after the coach sets a new calorie target. The answer goes to the coach (client_nutrition_feedback), who can scale the plan
// to the new number, rebuild it with what the client asked for, or leave it. In youth mode no calorie number is shown, only that the target changed.
export function RecalcPromptCard({
  athleteId,
  groupId,
  effectiveFrom,
  calories,
  showCalories,
}: {
  athleteId: string;
  groupId: string;
  effectiveFrom: string;
  calories: number;
  showCalories: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"ask" | "change">("ask");
  const [text, setText] = useState("");
  const [boring, setBoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function send(happy: boolean) {
    setError(null);
    setBusy(true);
    const supabase = createBrowserClient();
    const { error: insertError } = await supabase
      .from("client_nutrition_feedback")
      .insert({ athlete_id: athleteId, group_id: groupId, target_effective_from: effectiveFrom, ...answerRow({ happy, text, boring }) });
    setBusy(false);
    // Already answered for this target (another tab, a second tap): the answer is in, so this is done.
    if (insertError && insertError.code !== "23505") {
      setError(/most answers allowed/i.test(insertError.message) ? "You have sent the most answers allowed in a day. Try again tomorrow." : "Couldn't send that. Check your connection and try again.");
      return;
    }
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <section className="border border-steel/20 p-4" role="status">
        <p className="font-body text-sm text-chalk">Thanks. Your coach can see your answer.</p>
      </section>
    );
  }

  return (
    <section className="border border-rust/40 p-4 space-y-3" aria-labelledby="recalc-heading">
      <div>
        <h2 id="recalc-heading" className="font-display uppercase text-sm tracking-wide">
          Your target changed
        </h2>
        <p className="font-body text-sm text-chalk mt-1">
          {showCalories ? `Your daily target is now ${calories.toLocaleString("en-US")} calories.` : "Your daily nutrition target changed."} Are you happy with your meal plan?
        </p>
      </div>
      {mode === "ask" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => send(true)} className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
            {busy ? "Sending…" : "Happy with it"}
          </button>
          <button type="button" disabled={busy} onClick={() => setMode("change")} className="h-11 px-5 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
            I&apos;d change something
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="font-body text-xs text-steel">What would you change? (optional)</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_ANSWER_TEXT))}
              rows={3}
              className="mt-1 w-full bg-graphite border border-steel/30 p-2 font-body text-sm text-chalk"
              placeholder="More fish, fewer eggs, bigger dinners…"
            />
          </label>
          <label className="flex items-center gap-2 font-body text-sm text-chalk min-h-[2.75rem]">
            <input type="checkbox" checked={boring} onChange={(e) => setBoring(e.target.checked)} className="h-5 w-5" />
            It&apos;s getting boring, I want more variety
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || (!text.trim() && !boring)} onClick={() => send(false)} className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              {busy ? "Sending…" : "Send to my coach"}
            </button>
            <button type="button" disabled={busy} onClick={() => setMode("ask")} className="h-11 px-5 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
              Back
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
