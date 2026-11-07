"use client";

import { useState } from "react";
import Link from "next/link";
import { zonedTimeToUtc } from "@/lib/timezone";
import { COMMON_TIMEZONES } from "@/components/coach/desktop/timezone-control";

const GOAL_OPTIONS: { value: string; label: string }[] = [
  { value: "weight_loss", label: "Lose weight" },
  { value: "body_recomp", label: "Body recomposition" },
  { value: "muscle_gain", label: "Build muscle" },
  { value: "bodybuilding", label: "Bodybuilding" },
  { value: "powerbuilding_strongman", label: "Powerlifting / Strongman" },
  { value: "endurance_event", label: "Training for an endurance event" },
  { value: "custom", label: "Something else" },
];

// org_calendar_spotter_trainer_dispatch_scoping_sept19.md — the
// prospect-facing side of the org intake. No real slots to pick from
// (unlike /book/[coachId], which already knows which one coach it's
// scoping to) — the prospect states a plain date/time/goal, and the
// org's own trainers get cascaded to based on who's actually available
// then and who fits the goal best.
export function OrgTrainerRequestForm({ organizationId, orgName }: { organizationId: string; orgName: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
  );
  const [goalType, setGoalType] = useState("");
  const [goalCustomLabel, setGoalCustomLabel] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string } | null>(null);

  const canSubmit = name.trim() && email.trim() && date && time && goalType;
  const field = "w-full h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust";
  const label = "font-body text-xs text-steel uppercase tracking-wide block mb-1";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const requestedStartAt = zonedTimeToUtc(date, time, timezone);

    try {
      const res = await fetch("/api/org-dispatch/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          prospectName: name,
          prospectEmail: email,
          prospectPhone: phone || null,
          prospectTimezone: timezone,
          requestedStartAt: requestedStartAt.toISOString(),
          goalType,
          goalCustomLabel: goalType === "custom" ? goalCustomLabel : null,
          message: message || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong — try again.");
        setSubmitting(false);
        return;
      }
      setResult({ message: data.message ?? `We're finding you a coach at ${orgName} — you'll hear back shortly.` });
    } catch {
      setError("Something went wrong — check your connection and try again.");
    }
    setSubmitting(false);
  }

  if (result) {
    return (
      <div className="max-w-sm mx-auto px-6 py-16 text-center">
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust">{orgName}</p>
        <h1 className="font-display font-bold text-2xl uppercase leading-tight mt-2">Request sent!</h1>
        <p className="font-body text-sm text-steel mt-4">{result.message}</p>
        <Link href="/" className="inline-flex items-center justify-center h-11 px-6 mt-5 bg-rust text-graphite font-body text-sm font-medium">
          Go to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto px-6 py-16">
      <p className="font-display uppercase text-xs tracking-[0.2em] text-rust text-center">{orgName}</p>
      <h1 className="font-display font-bold text-2xl uppercase leading-tight mt-2 text-center">
        Train with us
      </h1>
      <p className="font-body text-sm text-steel mt-3 text-center">
        Tell us when you&apos;d like to train and what you&apos;re working toward — we&apos;ll match you with
        the right coach.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="org-req-name" className={label}>
            Your name
          </label>
          <input id="org-req-name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required className={field} />
        </div>
        <div>
          <label htmlFor="org-req-email" className={label}>
            Email
          </label>
          <input id="org-req-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className={field} />
        </div>
        <div>
          <label htmlFor="org-req-phone" className={label}>
            Phone (optional)
          </label>
          <input id="org-req-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" className={field} />
        </div>

        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label htmlFor="org-req-date" className={label}>
              Preferred date
            </label>
            <input id="org-req-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={field} />
          </div>
          <div className="flex-1 min-w-0">
            <label htmlFor="org-req-time" className={label}>
              Preferred time
            </label>
            <input id="org-req-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required className={field} />
          </div>
        </div>
        <div>
          <label htmlFor="org-req-tz" className={label}>
            Time zone
          </label>
          <select id="org-req-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={field}>
            {!COMMON_TIMEZONES.some((t) => t.value === timezone) && <option value={timezone}>{timezone}</option>}
            {COMMON_TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="org-req-goal" className={label}>
            Your goal
          </label>
          <select id="org-req-goal" value={goalType} onChange={(e) => setGoalType(e.target.value)} required className={field}>
            <option value="" disabled>
              Pick one
            </option>
            {GOAL_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        {goalType === "custom" && (
          <div>
            <label htmlFor="org-req-goal-more" className={label}>
              Tell us more
            </label>
            <input id="org-req-goal-more" type="text" value={goalCustomLabel} onChange={(e) => setGoalCustomLabel(e.target.value)} className={field} />
          </div>
        )}

        <div>
          <label htmlFor="org-req-message" className={label}>
            Anything else we should know? (optional)
          </label>
          <textarea id="org-req-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust" />
        </div>

        {error && (
          <p className="font-body text-xs text-rust text-center" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="w-full h-12 bg-rust text-graphite font-display uppercase text-sm font-bold disabled:opacity-40"
        >
          {submitting ? "Sending…" : "Request a coach"}
        </button>
        {!canSubmit && <p className="font-body text-xs text-steel text-center">Fill in your name, email, a date and time, and a goal to send it.</p>}
      </form>
    </div>
  );
}
