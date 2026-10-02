"use client";

import { useMemo, useState } from "react";
import { Search, Delete } from "lucide-react";

interface RosterEntry {
  athleteId: string;
  fullName: string;
  hasPin: boolean;
}

type View = { mode: "list" } | { mode: "pin"; athlete: RosterEntry } | { mode: "confirmed"; name: string; at: string };

// Large-format, tablet-friendly — meant to sit on a shared device at
// the entrance, so every tap target is big and nothing here assumes a
// keyboard. Real PIN verification is a server round trip
// (/api/kiosk/checkin) since the roster this component receives
// deliberately never carries the actual PIN value.
export function KioskCheckinScreen({
  groupId,
  groupName,
  roster,
}: {
  groupId: string;
  groupName: string;
  roster: RosterEntry[];
}) {
  const [view, setView] = useState<View>({ mode: "list" });
  const [query, setQuery] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [roster, query]);

  function openPinEntry(athlete: RosterEntry) {
    setPin("");
    setError(null);
    setView({ mode: "pin", athlete });
  }

  function pressDigit(d: string) {
    if (pin.length >= 4) return;
    setError(null);
    setPin((prev) => prev + d);
  }

  function backspace() {
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  }

  async function submitPin(athlete: RosterEntry, fullPin: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/kiosk/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, athleteId: athlete.athleteId, pin: fullPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't check in — try again.");
        setPin("");
        setSubmitting(false);
        return;
      }
      setView({ mode: "confirmed", name: athlete.fullName, at: data.checkedInAt });
      setSubmitting(false);
      setTimeout(() => {
        setView({ mode: "list" });
        setQuery("");
      }, 2500);
    } catch {
      setError("Couldn't check in — try again.");
      setPin("");
      setSubmitting(false);
    }
  }

  if (view.mode === "pin") {
    const athlete = view.athlete;
    if (pin.length === 4 && !submitting) {
      // Auto-submit the instant the 4th digit lands — no extra tap.
      submitPin(athlete, pin);
    }
    return (
      <main className="min-h-screen bg-graphite text-chalk flex flex-col items-center justify-center px-6">
        <p className="font-body text-sm text-steel mb-1">Enter your PIN</p>
        <h1 className="font-display font-bold text-3xl uppercase mb-8">{athlete.fullName}</h1>

        {!athlete.hasPin ? (
          <p className="font-body text-rust text-center max-w-xs mb-8">
            No PIN has been set for you yet — ask your coach to set one.
          </p>
        ) : (
          <>
            <div className="flex gap-4 mb-8">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-5 h-5 rounded-full border-2 border-rust ${
                    i < pin.length ? "bg-rust" : "bg-transparent"
                  }`}
                />
              ))}
            </div>
            {error && <p className="font-body text-sm text-rust mb-4">{error}</p>}
            <div className="grid grid-cols-3 gap-4 w-72">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => pressDigit(d)}
                  disabled={submitting}
                  className="h-20 bg-surface border border-steel/30 font-display text-2xl disabled:opacity-40"
                >
                  {d}
                </button>
              ))}
              <div />
              <button
                type="button"
                onClick={() => pressDigit("0")}
                disabled={submitting}
                className="h-20 bg-surface border border-steel/30 font-display text-2xl disabled:opacity-40"
              >
                0
              </button>
              <button
                type="button"
                onClick={backspace}
                disabled={submitting}
                className="h-20 bg-surface border border-steel/30 flex items-center justify-center disabled:opacity-40"
              >
                <Delete className="w-6 h-6" />
              </button>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={() => setView({ mode: "list" })}
          className="mt-10 font-body text-sm text-steel underline underline-offset-2"
        >
          Not {athlete.fullName.split(" ")[0]}? Go back
        </button>
      </main>
    );
  }

  if (view.mode === "confirmed") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex flex-col items-center justify-center px-6">
        <div className="w-20 h-20 rounded-full bg-positive/20 border-2 border-positive flex items-center justify-center mb-6">
          <span className="font-display text-4xl text-positive">✓</span>
        </div>
        <h1 className="font-display font-bold text-3xl uppercase mb-2">Checked in!</h1>
        <p className="font-body text-lg text-steel">
          {view.name} —{" "}
          {new Date(view.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk px-6 py-10">
      <h1 className="font-display font-bold text-3xl uppercase text-center mb-1">{groupName}</h1>
      <p className="font-body text-sm text-steel text-center mb-8">Tap your name to check in</p>

      <div className="max-w-md mx-auto mb-6 relative">
        <Search className="w-5 h-5 text-steel absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your name…"
          className="w-full h-14 bg-surface border border-steel/30 pl-11 pr-4 font-body text-lg text-chalk focus:outline-none focus:border-rust"
        />
      </div>

      <div className="max-w-md mx-auto space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.length === 0 && (
          <p className="font-body text-sm text-steel text-center py-6">No match.</p>
        )}
        {filtered.map((r) => (
          <button
            key={r.athleteId}
            type="button"
            onClick={() => openPinEntry(r)}
            className="w-full h-16 bg-surface border border-steel/20 flex items-center px-5 font-body text-lg active:bg-rust/10 active:border-rust/40"
          >
            {r.fullName}
          </button>
        ))}
      </div>
    </main>
  );
}
