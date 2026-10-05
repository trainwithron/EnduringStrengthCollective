"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatInTimezone } from "@/lib/format-in-timezone";
import type { PublicPageView } from "@/lib/public-booking-engine";

interface Slot {
  dateKey: string;
  startIso: string;
}

interface Booked {
  coachName: string;
  typeName: string;
  startIso: string;
  timezone: string;
  manageUrl: string;
  emailSent: boolean;
}

function dayLabel(dateKey: string): { weekday: string; rest: string } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    rest: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  };
}

const field = "w-full bg-transparent border border-steel/40 px-3 py-2.5 font-body text-base text-chalk focus:outline-none focus:border-rust";

// A coach's public booking page. Pick a session, a day and a time (all from the coach's real calendar), enter a name and email,
// done: no account needed. The visitor gets a private link to change or cancel.
export function PublicBookingFlow({ slug, page }: { slug: string; page: PublicPageView }) {
  const types = page.sessionTypes;
  const [typeId, setTypeId] = useState<string | null>(types.length === 1 ? types[0].id : null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [timezone, setTimezone] = useState<string>("America/New_York");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [startIso, setStartIso] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [copied, setCopied] = useState(false);
  const renderedAt = useRef<number>(Date.now());

  const type = types.find((t) => t.id === typeId) ?? null;

  useEffect(() => {
    if (!typeId) return;
    let cancelled = false;
    setSlots(null);
    setLoadError(null);
    setDateKey(null);
    setStartIso(null);
    fetch(`/api/public-booking/${slug}/slots?type=${encodeURIComponent(typeId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error ?? "We couldn't load the times.");
          return;
        }
        setSlots(data.slots as Slot[]);
        setTimezone(data.timezone);
        const first = (data.slots as Slot[])[0];
        if (first) setDateKey(first.dateKey);
      })
      .catch(() => !cancelled && setLoadError("We couldn't load the times. Check your connection and try again."));
    return () => {
      cancelled = true;
    };
  }, [slug, typeId]);

  const days = useMemo(() => {
    const seen: string[] = [];
    for (const s of slots ?? []) if (!seen.includes(s.dateKey)) seen.push(s.dateKey);
    return seen;
  }, [slots]);
  const timesForDay = useMemo(() => (slots ?? []).filter((s) => s.dateKey === dateKey), [slots, dateKey]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!typeId || !startIso || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public-booking/${slug}/book`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionTypeId: typeId, startIso, name, email, phone, note, website, renderedAtMs: renderedAt.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "We couldn't complete your booking.");
        // A taken time means the list is out of date: reload it.
        if (res.status === 409) {
          setStartIso(null);
          const fresh = await fetch(`/api/public-booking/${slug}/slots?type=${encodeURIComponent(typeId)}`).then((r) => r.json()).catch(() => null);
          if (fresh?.slots) setSlots(fresh.slots);
        }
        return;
      }
      setBooked(data as Booked);
    } catch {
      setError("We couldn't complete your booking. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is visible on the page to copy by hand.
    }
  }

  if (booked) {
    return (
      <div className="max-w-lg mx-auto px-5 py-10">
        <p className="font-display uppercase text-sm tracking-wide text-steel">Booked</p>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-2">You&apos;re on the calendar</h1>
        <p className="font-body text-base mt-4">
          {booked.typeName} with {booked.coachName}
          <br />
          <span className="text-chalk">{formatInTimezone(new Date(booked.startIso), booked.timezone, "dateTime")}</span>
        </p>
        <div className="border border-steel/30 bg-surface/40 p-4 mt-6">
          <p className="font-body text-sm text-chalk">
            {booked.emailSent ? "We emailed you a private link to change or cancel." : "Save this private link. It's how you change or cancel."}
          </p>
          <p className="font-body text-xs text-steel mt-2 break-all select-all">{booked.manageUrl}</p>
          <div className="flex flex-wrap gap-3 mt-3">
            <button type="button" onClick={() => copy(booked.manageUrl)} className="border border-steel/40 text-chalk font-body text-sm px-4 py-2">
              {copied ? "Copied" : "Copy link"}
            </button>
            <a href={booked.manageUrl} className="bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2">
              Change or cancel
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-5 py-10">
      <p className="font-display uppercase text-sm tracking-wide text-steel">{page.coachName}</p>
      <h1 className="font-display font-bold text-3xl uppercase leading-none mt-2">{page.headline || "Book a session"}</h1>
      {page.intro && <p className="font-body text-base text-steel mt-3 whitespace-pre-line">{page.intro}</p>}

      {types.length === 0 ? (
        <p className="font-body text-sm text-steel mt-8">No sessions are available to book online right now.</p>
      ) : (
        <>
          <section className="mt-8" aria-label="Choose a session">
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">1. Session</h2>
            <div className="space-y-2">
              {types.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTypeId(t.id)}
                  aria-pressed={typeId === t.id}
                  className={`w-full text-left border px-4 py-3 ${typeId === t.id ? "border-rust" : "border-steel/30"}`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-body text-base text-chalk">{t.name}</span>
                    {t.priceLabel && <span className="font-body text-sm text-chalk">{t.priceLabel}</span>}
                  </span>
                  <span className="font-body text-xs text-steel block mt-0.5">
                    {t.durationMinutes} min · {t.where}
                  </span>
                  {t.description && <span className="font-body text-xs text-steel block mt-1">{t.description}</span>}
                </button>
              ))}
            </div>
          </section>

          {typeId && (
            <section className="mt-8" aria-label="Choose a time">
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">2. Day and time</h2>
              {loadError && (
                <p className="font-body text-sm text-rust" role="alert">
                  {loadError}
                </p>
              )}
              {!loadError && slots === null && <p className="font-body text-sm text-steel">Loading times…</p>}
              {slots && days.length === 0 && (
                <p className="font-body text-sm text-steel">No times are open in the next few weeks. Check back soon.</p>
              )}
              {days.length > 0 && (
                <>
                  <div className="flex gap-2 overflow-x-auto pb-2" role="listbox" aria-label="Day">
                    {days.map((d) => {
                      const l = dayLabel(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          role="option"
                          aria-selected={dateKey === d}
                          onClick={() => {
                            setDateKey(d);
                            setStartIso(null);
                          }}
                          className={`shrink-0 border px-3 py-2 text-center ${dateKey === d ? "border-rust text-chalk" : "border-steel/30 text-steel"}`}
                        >
                          <span className="font-body text-xs block">{l.weekday}</span>
                          <span className="font-body text-sm block">{l.rest}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {timesForDay.map((s) => (
                      <button
                        key={s.startIso}
                        type="button"
                        aria-pressed={startIso === s.startIso}
                        onClick={() => setStartIso(s.startIso)}
                        className={`border px-2 py-2 font-body text-sm ${startIso === s.startIso ? "border-rust bg-rust text-graphite" : "border-steel/30 text-chalk"}`}
                      >
                        {formatInTimezone(new Date(s.startIso), timezone, "time")}
                      </button>
                    ))}
                  </div>
                  <p className="font-body text-xs text-steel mt-2">Times are in the coach&apos;s time zone ({timezone.replace("_", " ")}).</p>
                  {error && !startIso && (
                    <p className="font-body text-sm text-rust mt-3" role="alert">
                      {error}
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          {startIso && type && (
            <form onSubmit={submit} className="mt-8" aria-label="Your details">
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">3. Your details</h2>
              <p className="font-body text-sm text-chalk mb-3">
                {type.name}, {formatInTimezone(new Date(startIso), timezone, "dateTime")}
              </p>
              <div className="space-y-3">
                <label className="block">
                  <span className="font-body text-xs text-steel block mb-1">Name</span>
                  <input className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" />
                </label>
                <label className="block">
                  <span className="font-body text-xs text-steel block mb-1">Email</span>
                  <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
                </label>
                <label className="block">
                  <span className="font-body text-xs text-steel block mb-1">Phone (optional)</span>
                  <input className={field} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} autoComplete="tel" />
                </label>
                <label className="block">
                  <span className="font-body text-xs text-steel block mb-1">Anything your coach should know (optional)</span>
                  <textarea className={field} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                </label>
                {/* A field real people never see or fill. Anything typed here marks the form as a bot. */}
                <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
                  <label>
                    Website
                    <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                  </label>
                </div>
              </div>
              {error && (
                <p className="font-body text-sm text-rust mt-3" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="mt-4 w-full bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-3 disabled:opacity-40"
              >
                {busy ? "Booking…" : "Book this session"}
              </button>
              <p className="font-body text-xs text-steel mt-3">
                By booking you agree to be contacted about this session. You&apos;ll get a private link to change or cancel.
              </p>
            </form>
          )}
        </>
      )}
    </div>
  );
}
