"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FOOD_CHECKIN_ANCHOR, reasonLabel, reworkRequests, triggerPill } from "@/lib/food-checkin";
import { REBUILD_WITH_REQUESTS_EVENT, type RebuildWithRequests } from "@/lib/meal-plan-rebuild";
import { coachThreadHref } from "@/lib/direct-message-send";

// The food check-in on the coach's nutrition view of a client, in the Nutrition Spotter area (Nov 24; the approved mockup is reports/nutrition-checkin-nudge-mockup.html): why it went
// out, when, and the client's answer. "Rework <name>'s plan" builds the meal plan again with the answer as the requests (the same rebuild as the recalc prompt's answers),
// "Message <name>" opens the thread, "Mark handled" closes it.
export interface CoachFoodCheckin {
  id: string;
  trigger: string;
  avg_diff_kcal: number | null;
  days_logged: number | null;
  sent_at: string;
  status: string;
  reasons: string[];
  note: string | null;
  answered_at: string | null;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function FoodCheckinPanel({ checkin, groupId, athleteId, clientFirstName }: { checkin: CoachFoodCheckin; groupId: string; athleteId: string; clientFirstName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const answered = checkin.status === "answered";
  const requests = reworkRequests({ reasons: checkin.reasons, note: checkin.note });

  // The builder (Meal plan, further down this page) listens for this; its section is opened so the new plan shows.
  function rework() {
    setError(null);
    const fold = document.getElementById("meal-plan");
    if (fold instanceof HTMLDetailsElement && !fold.open) fold.open = true;
    const detail: RebuildWithRequests = { requests };
    window.dispatchEvent(new CustomEvent<RebuildWithRequests>(REBUILD_WITH_REQUESTS_EVENT, { detail }));
    setMessage(requests ? `Rebuilt below with ${clientFirstName}'s answer: ${requests}. Look it over, then save it.` : "Rebuilt below. Look it over, then save it.");
  }

  async function markHandled() {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let ok = false;
    try {
      ok = (await fetch("/api/food-checkins/handle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: checkin.id }) })).ok;
    } catch {
      ok = false;
    }
    inFlight.current = false;
    setBusy(false);
    if (!ok) {
      setError("That didn't save. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div id={FOOD_CHECKIN_ANCHOR} className="border border-rust/40 bg-rust/5 p-4 space-y-3 scroll-mt-24" data-food-checkin-panel>
      <p className="font-body text-xs text-rust-ink uppercase tracking-wide font-medium">Nutrition Spotter</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center min-h-7 px-2.5 rounded-token-pill border border-rust/50 font-body text-xs text-rust-ink" data-food-checkin-pill>
          {triggerPill(checkin)}
        </span>
        <span className="font-body text-xs text-steel">Check-in sent {shortDate(checkin.sent_at)}</span>
      </div>
      {answered ? (
        <div className="space-y-1" data-food-checkin-answer>
          <p className="font-body text-xs text-steel">
            {clientFirstName}&apos;s answer{checkin.answered_at ? ` · ${shortDate(checkin.answered_at)}` : ""}
          </p>
          {checkin.reasons.length > 0 && <p className="font-body text-sm text-chalk">{checkin.reasons.map(reasonLabel).join(" · ")}</p>}
          {checkin.note && <p className="font-body text-sm text-chalk whitespace-pre-line break-words">&ldquo;{checkin.note}&rdquo;</p>}
        </div>
      ) : (
        <p className="font-body text-sm text-steel">{checkin.status === "expired" ? `${clientFirstName} didn't answer.` : `Waiting on ${clientFirstName}.`}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {answered && (
          <button type="button" onClick={rework} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium">
            Rework {clientFirstName}&apos;s plan
          </button>
        )}
        <Link href={coachThreadHref(groupId, athleteId)} className="inline-flex items-center h-11 px-4 border border-steel/40 text-chalk font-body text-sm">
          Message {clientFirstName}
        </Link>
        <button type="button" onClick={() => void markHandled()} disabled={busy} className="h-11 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
          {busy ? "Saving…" : "Mark handled"}
        </button>
      </div>
      {message && <p className="font-body text-xs text-steel">{message}</p>}
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
