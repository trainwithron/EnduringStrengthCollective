"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MAX_PLAN_TRIES, MAX_RETRY_NOTE, type RetryState } from "@/lib/meal-plan-retry";

// "Not feeling it? Tell us what to change." under the client's meals. They type what to change, the plan is rebuilt from the recipe library (nothing they type goes to an AI), and
// the coach is told. Up to 3 tries per plan the coach assigned; after that the box points at a message to the coach. Built for a phone: one field, one big button.
export function MealPlanRetryBox({ groupId, state }: { groupId: string; state: RetryState }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tryNumber: number; triesLeft: number } | null>(null);

  const messageHref = `/groups/${groupId}/messages`;

  // Nothing planned from today on: no box.
  if (state.kind === "no_plan") return null;

  if (state.kind === "hand_built" || state.kind === "none_left") {
    return (
      <section className="border border-steel/20 p-4 space-y-2">
        {done && (
          <p className="font-body text-sm text-chalk" role="status">
            Done. Your plan was rebuilt from your coach&apos;s recipes and your coach was told. That was your last try.
          </p>
        )}
        <h2 className="font-display uppercase text-sm tracking-wide">Not feeling it?</h2>
        <p className="font-body text-sm text-chalk">
          {state.kind === "none_left" ? "You've used all your tries on this plan." : "Your coach planned these days by hand."} Tell your coach what to change.
        </p>
        <Link href={messageHref} className="inline-flex items-center h-11 px-5 bg-rust text-graphite font-body text-sm font-medium">
          Message your coach
        </Link>
      </section>
    );
  }

  async function send() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/nutrition/plan-retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId, note: text }) });
      const data = (await res.json().catch(() => null)) as { error?: string; tryNumber?: number; triesLeft?: number } | null;
      if (!res.ok || !data || typeof data.tryNumber !== "number") {
        setError(data?.error ?? "Couldn't change your plan. Check your connection and try again.");
        return;
      }
      setDone({ tryNumber: data.tryNumber, triesLeft: data.triesLeft ?? 0 });
      setText("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Couldn't change your plan. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const left = done ? done.triesLeft : state.triesLeft;

  return (
    <section className="border border-steel/20 p-4 space-y-3">
      {done && (
        <p className="font-body text-sm text-chalk" role="status">
          Done. Your plan was rebuilt from your coach&apos;s recipes and your coach was told.
          {done.triesLeft > 0 ? ` You have ${done.triesLeft} ${done.triesLeft === 1 ? "try" : "tries"} left.` : " That was your last try."}
        </p>
      )}
      {left === 0 ? (
        <div className="space-y-2">
          <p className="font-body text-sm text-chalk">Still not right? Tell your coach what to change.</p>
          <Link href={messageHref} className="inline-flex items-center h-11 px-5 bg-rust text-graphite font-body text-sm font-medium">
            Message your coach
          </Link>
        </div>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="w-full text-left min-h-11">
          <span className="font-display uppercase text-sm tracking-wide block">Not feeling it?</span>
          <span className="font-body text-sm text-steel">Tell us what to change. ({left} of {MAX_PLAN_TRIES} {left === 1 ? "try" : "tries"} left)</span>
        </button>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="font-display uppercase text-sm tracking-wide block">Tell us what to change</span>
            <span className="font-body text-xs text-steel block mt-1">For example: no fish, more chicken, vegetarian. We rebuild your meals from your coach&apos;s recipes and tell your coach.</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_RETRY_NOTE))}
              rows={3}
              maxLength={MAX_RETRY_NOTE}
              className="mt-2 w-full bg-transparent border border-steel/40 p-3 font-body text-base text-chalk placeholder:text-steel/60"
              placeholder="No fish, more chicken"
            />
          </label>
          {error && (
            <p className="font-body text-sm text-rust" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || text.trim().length === 0} onClick={send} className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              {busy ? "Rebuilding…" : "Rebuild my plan"}
            </button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className="h-11 px-5 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
              Cancel
            </button>
          </div>
          <p className="font-body text-xs text-steel">
            {left} of {MAX_PLAN_TRIES} {left === 1 ? "try" : "tries"} left on this plan.
          </p>
        </div>
      )}
    </section>
  );
}
