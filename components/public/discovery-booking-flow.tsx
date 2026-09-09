"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

interface Slot {
  start: string;
  durationMinutes: number;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// The entire prospect-facing flow: pick a date, pick an open slot, leave
// contact info, confirm — no login, no account. Everything reads through
// the public /api/discovery-availability route (never a direct table
// read) and writes through the book_discovery_call RPC (the only anon
// grant this feature needs).
export function DiscoveryBookingFlow({ coachId }: { coachId: string }) {
  const [date, setDate] = useState(todayKey());
  const [coachName, setCoachName] = useState<string | null>(null);
  const [hasAnyAvailability, setHasAnyAvailability] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Slot | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingSlots(true);
    setSelectedSlot(null);
    fetch(`/api/discovery-availability/${coachId}?date=${date}`)
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        return r.ok ? r.json() : Promise.reject();
      })
      .then((json) => {
        if (cancelled || !json) return;
        setCoachName(json.coachName);
        setHasAnyAvailability(json.hasAnyAvailability);
        setSlots(json.slots ?? []);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coachId, date]);

  async function handleConfirm() {
    if (!selectedSlot) return;
    if (!name.trim() || !email.trim()) {
      setFormError("Name and email are required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const supabase = createBrowserClient();
    const endAt = new Date(
      new Date(selectedSlot.start).getTime() + selectedSlot.durationMinutes * 60000
    );
    const { error } = await supabase.rpc("book_discovery_call", {
      p_coach_id: coachId,
      p_start_at: selectedSlot.start,
      p_end_at: endAt.toISOString(),
      p_prospect_name: name.trim(),
      p_prospect_email: email.trim(),
      p_prospect_phone: phone.trim() || null,
      p_message: message.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      setFormError(
        error.message.includes("just taken")
          ? "That time was just taken — pick another slot."
          : "Couldn't book that call — try again."
      );
      return;
    }
    setConfirmed(selectedSlot);
  }

  if (notFound) {
    return (
      <div className="max-w-md mx-auto py-20 px-6 text-center">
        <p className="font-body text-steel">This booking link isn&apos;t valid.</p>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="max-w-md mx-auto py-20 px-6 text-center">
        <h1 className="font-display font-bold text-2xl uppercase mb-3">Call booked</h1>
        <p className="font-body text-steel">
          {new Date(confirmed.start).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}{" "}
          at {formatSlotTime(confirmed.start)}
          {coachName ? ` with ${coachName}` : ""}.
        </p>
        <p className="font-body text-sm text-steel mt-2">
          You&apos;ll be contacted at {email} to confirm details.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-12 px-6">
      <h1 className="font-display font-bold text-2xl uppercase mb-1">
        {coachName ? `Book a call with ${coachName}` : "Book a discovery call"}
      </h1>
      <p className="font-body text-sm text-steel mb-6">
        Pick a time that works — no account needed.
      </p>

      <label className="block mb-4">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Date</span>
        <input
          type="date"
          value={date}
          min={todayKey()}
          onChange={(e) => setDate(e.target.value)}
          className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
      </label>

      {loadingSlots ? (
        <p className="font-body text-sm text-steel py-4">Loading times…</p>
      ) : !hasAnyAvailability ? (
        <p className="font-body text-sm text-steel py-4">
          This coach isn&apos;t taking discovery call bookings right now.
        </p>
      ) : slots.length === 0 ? (
        <p className="font-body text-sm text-steel py-4">No open times this day — try another date.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 mb-6">
          {slots.map((slot) => (
            <button
              key={slot.start}
              type="button"
              onClick={() => setSelectedSlot(slot)}
              className={`h-10 font-body text-sm border transition-colors ${
                selectedSlot?.start === slot.start
                  ? "bg-rust text-graphite border-rust"
                  : "border-steel/30 text-chalk active:border-rust active:text-rust"
              }`}
            >
              {formatSlotTime(slot.start)}
            </button>
          ))}
        </div>
      )}

      {selectedSlot && (
        <div className="space-y-3 border-t border-steel/20 pt-5">
          <label className="block">
            <span className="font-body text-xs text-steel uppercase tracking-wide">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
            />
          </label>
          <label className="block">
            <span className="font-body text-xs text-steel uppercase tracking-wide">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
            />
          </label>
          <label className="block">
            <span className="font-body text-xs text-steel uppercase tracking-wide">
              Phone (optional)
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
            />
          </label>
          <label className="block">
            <span className="font-body text-xs text-steel uppercase tracking-wide">
              What are you looking to work on? (optional)
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full mt-1 bg-graphite border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
            />
          </label>

          {formError && <p className="font-body text-xs text-rust">{formError}</p>}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="w-full h-11 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            {submitting
              ? "Booking…"
              : `Confirm ${formatSlotTime(selectedSlot.start)}`}
          </button>
        </div>
      )}
    </div>
  );
}
