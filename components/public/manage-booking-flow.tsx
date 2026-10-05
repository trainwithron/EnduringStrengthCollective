"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatInTimezone } from "@/lib/format-in-timezone";

interface Slot {
  dateKey: string;
  startIso: string;
}

// A visitor's private page for one booking: see it, move it to another open time, or cancel it. No account needed; the long
// random address in the link is the only credential.
export function ManageBookingFlow({
  token,
  coachName,
  typeName,
  startIso,
  timezone,
  status,
  canChange,
  reason,
  guestName,
}: {
  token: string;
  coachName: string;
  typeName: string | null;
  startIso: string;
  timezone: string;
  status: string;
  canChange: boolean;
  reason: string | null;
  guestName: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "move">("view");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function act(body: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/public-booking/manage/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      setMessage({ text: data.message ?? data.error ?? "That didn't work.", error: !res.ok });
      if (res.ok) {
        setMode("view");
        router.refresh();
      }
    } catch {
      setMessage({ text: "That didn't work. Check your connection and try again.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function startMove() {
    setMode("move");
    setMessage(null);
    if (slots) return;
    const res = await fetch(`/api/public-booking/manage/${token}/slots`).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setMessage({ text: data.error ?? "We couldn't load the times.", error: true });
      return;
    }
    setSlots(data.slots as Slot[]);
    setDateKey((data.slots as Slot[])[0]?.dateKey ?? null);
  }

  const days = [...new Set((slots ?? []).map((s) => s.dateKey))];
  const times = (slots ?? []).filter((s) => s.dateKey === dateKey);
  const cancelled = status !== "confirmed";

  return (
    <div className="max-w-lg mx-auto px-5 py-10">
      <p className="font-display uppercase text-sm tracking-wide text-steel">Your booking</p>
      <h1 className="font-display font-bold text-3xl uppercase leading-none mt-2">{cancelled ? "Cancelled" : "You're booked"}</h1>
      <p className="font-body text-base mt-4">
        Hi {guestName.split(" ")[0]}. {typeName ?? "Your session"} with {coachName}
        <br />
        <span className={cancelled ? "text-steel line-through" : "text-chalk"}>{formatInTimezone(new Date(startIso), timezone, "dateTime")}</span>
      </p>

      {!cancelled && !canChange && reason && <p className="font-body text-sm text-steel mt-4">{reason}</p>}

      {!cancelled && canChange && mode === "view" && (
        <div className="flex flex-wrap gap-3 mt-6">
          <button type="button" onClick={startMove} className="border border-steel/40 text-chalk font-body text-sm px-4 py-2.5">
            Change the time
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Cancel this session?")) act({ action: "cancel" });
            }}
            className="border border-rust text-rust font-body text-sm px-4 py-2.5 disabled:opacity-40"
          >
            Cancel session
          </button>
        </div>
      )}

      {mode === "move" && (
        <section className="mt-6" aria-label="Pick a new time">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">New day and time</h2>
          {slots === null && <p className="font-body text-sm text-steel">Loading times…</p>}
          {slots && days.length === 0 && <p className="font-body text-sm text-steel">No other times are open right now.</p>}
          {days.length > 0 && (
            <>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {days.map((d) => {
                  const [y, m, dd] = d.split("-").map(Number);
                  const date = new Date(Date.UTC(y, m - 1, dd, 12));
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDateKey(d)}
                      aria-pressed={dateKey === d}
                      className={`shrink-0 border px-3 py-2 text-center ${dateKey === d ? "border-rust text-chalk" : "border-steel/30 text-steel"}`}
                    >
                      <span className="font-body text-xs block">{date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</span>
                      <span className="font-body text-sm block">{date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {times.map((s) => (
                  <button
                    key={s.startIso}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Move your session to ${formatInTimezone(new Date(s.startIso), timezone, "dateTime")}?`)) act({ action: "reschedule", startIso: s.startIso });
                    }}
                    className="border border-steel/30 px-2 py-2 font-body text-sm text-chalk disabled:opacity-40"
                  >
                    {formatInTimezone(new Date(s.startIso), timezone, "time")}
                  </button>
                ))}
              </div>
            </>
          )}
          <button type="button" onClick={() => setMode("view")} className="font-body text-sm text-steel underline mt-4">
            Back
          </button>
        </section>
      )}

      {message && (
        <p className={`font-body text-sm mt-4 ${message.error ? "text-rust" : "text-chalk"}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
