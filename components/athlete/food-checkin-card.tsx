"use client";

import { useRef, useState } from "react";
import { CHECKIN_NOTE_MAX, CHECKIN_REASONS, FOOD_CHECKIN_ANCHOR, type CheckinReason } from "@/lib/food-checkin";

// The coach's food check-in, at the top of the client's Nutrition and Home (Nov 24; the approved mockup is reports/nutrition-checkin-nudge-mockup.html). From the coach, in their
// voice: tick what applies, add a line if they like, and it goes back to the coach. "Not now" hides it for today (it stays open for the week).
export function FoodCheckinCard({ id, coachFirstName, message }: { id: string; coachFirstName: string; message: string }) {
  const [picked, setPicked] = useState<CheckinReason[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"sent" | "later" | null>(null);
  // set at once on the first tap (busy only shows on the next render): a very fast second tap never sends twice
  const inFlight = useRef(false);

  const toggle = (key: CheckinReason) => setPicked((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));

  async function post(path: string, body: object): Promise<boolean> {
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function send() {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const ok = await post("/api/food-checkins/answer", { id, reasons: picked, note });
    inFlight.current = false;
    setBusy(false);
    if (!ok) {
      setError("That didn't send. Check your connection and try again.");
      return;
    }
    setDone("sent");
  }

  async function notNow() {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    await post("/api/food-checkins/not-now", { id });
    inFlight.current = false;
    setBusy(false);
    setDone("later");
  }

  if (done === "later") return null;
  if (done === "sent") {
    return (
      <section id={FOOD_CHECKIN_ANCHOR} className="border border-steel/20 p-4 scroll-mt-24" role="status" data-food-checkin>
        <p className="font-body text-sm text-chalk">Sent. {coachFirstName} will see your answer.</p>
      </section>
    );
  }

  const canSend = picked.length > 0 || note.trim() !== "";
  return (
    <section id={FOOD_CHECKIN_ANCHOR} className="border border-rust/40 p-4 space-y-3 scroll-mt-24" aria-labelledby="food-checkin-heading" data-food-checkin>
      <div>
        <h2 id="food-checkin-heading" className="font-display uppercase text-sm tracking-wide">
          Quick check-in
        </h2>
        <p className="font-body text-xs text-steel">From {coachFirstName}</p>
      </div>
      <p className="font-body text-sm text-chalk">{message}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="What applies">
        {CHECKIN_REASONS.map((r) => {
          const on = picked.includes(r.key);
          return (
            <button
              key={r.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(r.key)}
              className={`min-h-11 px-3 font-body text-sm border text-left ${on ? "bg-rust/15 text-rust-ink border-rust/50" : "text-steel border-steel/30"}`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <label className="block">
        <span className="font-body text-xs text-steel">Anything else? (optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, CHECKIN_NOTE_MAX))}
          maxLength={CHECKIN_NOTE_MAX}
          rows={2}
          className="mt-1 w-full bg-graphite border border-steel/30 p-2 font-body text-sm text-chalk focus:outline-none focus:border-rust resize-none"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void send()} disabled={busy || !canSend} className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Sending…" : `Send to ${coachFirstName}`}
        </button>
        <button type="button" onClick={() => void notNow()} disabled={busy} className="h-11 px-5 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
          Not now
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
