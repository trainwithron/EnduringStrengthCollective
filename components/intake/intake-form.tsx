"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { PAR_Q_QUESTIONS } from "@/lib/par-q-questions";
import { DEFAULT_WAIVER_TEXT } from "@/lib/intake-waiver";
import { isUnder13 } from "@/lib/coppa";

type Step = "dob" | "blocked" | "form";

function computeInitialStep(
  dateOfBirth: string | null,
  parentalConsentVerified: boolean
): Step {
  if (!dateOfBirth) return "dob";
  if (isUnder13(dateOfBirth, new Date()) && !parentalConsentVerified) return "blocked";
  return "form";
}

export function IntakeForm({
  groupId,
  orgName,
  waiverText,
  waiverPdfUrl,
  nextUrl,
  initialParQAnswers,
  initialWaiverAccepted,
  initialWaiverSignedName,
  alreadyCompleted,
  initialDateOfBirth,
  parentalConsentVerified,
}: {
  groupId: string;
  orgName: string | null;
  waiverText: string | null;
  waiverPdfUrl: string | null;
  nextUrl: string;
  initialParQAnswers: { question: string; answer: boolean }[];
  initialWaiverAccepted: boolean;
  initialWaiverSignedName: string;
  alreadyCompleted: boolean;
  initialDateOfBirth: string | null;
  parentalConsentVerified: boolean;
}) {
  const router = useRouter();
  const answerByQuestion = new Map(initialParQAnswers.map((a) => [a.question, a.answer]));
  const [answers, setAnswers] = useState<Record<string, boolean | null>>(
    Object.fromEntries(PAR_Q_QUESTIONS.map((q) => [q, answerByQuestion.get(q) ?? null]))
  );
  const [waiverAccepted, setWaiverAccepted] = useState(initialWaiverAccepted);
  const [signedName, setSignedName] = useState(initialWaiverSignedName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(alreadyCompleted);
  const [step, setStep] = useState<Step>(
    alreadyCompleted ? "form" : computeInitialStep(initialDateOfBirth, parentalConsentVerified)
  );
  // "Check again" on the blocked step calls router.refresh(), which
  // re-fetches parentalConsentVerified on the server and passes a new
  // prop down — but useState's initializer only runs once on mount, so
  // without this the step would never leave "blocked" even after the
  // coach verifies consent. Only resyncs while genuinely still blocked,
  // so it never fights the user's own in-progress dob/form-step state.
  useEffect(() => {
    if (step === "blocked" && parentalConsentVerified) {
      setStep("form");
    }
  }, [parentalConsentVerified, step]);
  const [dateOfBirth, setDateOfBirth] = useState(initialDateOfBirth ?? "");
  const [dobSubmitting, setDobSubmitting] = useState(false);
  const [dobError, setDobError] = useState<string | null>(null);

  async function handleDobSubmit() {
    if (!dateOfBirth || dobSubmitting) return;
    setDobSubmitting(true);
    setDobError(null);

    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setDobError("Your session expired — please sign in again.");
      setDobSubmitting(false);
      return;
    }

    const { error: upsertError } = await supabase.from("client_intake").upsert(
      { athlete_id: user.id, group_id: groupId, date_of_birth: dateOfBirth },
      { onConflict: "athlete_id" }
    );

    if (upsertError) {
      setDobError(upsertError.message);
      setDobSubmitting(false);
      return;
    }

    setDobSubmitting(false);
    setStep(isUnder13(dateOfBirth, new Date()) && !parentalConsentVerified ? "blocked" : "form");
  }

  const allAnswered = PAR_Q_QUESTIONS.every((q) => answers[q] !== null);
  const canSubmit = allAnswered && waiverAccepted && signedName.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Your session expired — please sign in again.");
      setSubmitting(false);
      return;
    }

    const parQAnswers = PAR_Q_QUESTIONS.map((q) => ({ question: q, answer: answers[q] as boolean }));

    const { error: upsertError } = await supabase.from("client_intake").upsert(
      {
        athlete_id: user.id,
        group_id: groupId,
        par_q_answers: parQAnswers,
        waiver_signed_name: signedName.trim(),
        waiver_accepted: true,
        completed_at: new Date().toISOString(),
      },
      { onConflict: "athlete_id" }
    );

    if (upsertError) {
      setError(upsertError.message);
      setSubmitting(false);
      return;
    }

    setDone(true);
    router.push(nextUrl);
    router.refresh();
  }

  if (done) {
    return (
      <div className="border border-steel/20 p-6">
        <p className="font-body text-sm">
          You&apos;re all set — thanks for completing your intake. Taking you in…
        </p>
      </div>
    );
  }

  if (step === "dob") {
    return (
      <div className="space-y-4">
        <section>
          <h2 className="font-display uppercase text-lg font-bold mb-3">Your date of birth</h2>
          <p className="font-body text-sm text-steel mb-3">
            We ask this first so we know how to handle your information correctly.
          </p>
          <label htmlFor="date-of-birth" className="sr-only">
            Your date of birth
          </label>
          <input
            id="date-of-birth"
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className="w-full h-11 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
          />
        </section>

        {dobError && (
          <p className="font-body text-sm text-rust" role="alert">
            {dobError}
          </p>
        )}

        <button
          type="button"
          onClick={handleDobSubmit}
          disabled={!dateOfBirth || dobSubmitting}
          className="w-full h-12 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
        >
          {dobSubmitting ? "Saving…" : "Continue"}
        </button>
      </div>
    );
  }

  if (step === "blocked") {
    return (
      <div className="border border-steel/20 p-6 space-y-4">
        <p className="font-body text-sm">
          Because you&apos;re under 13, U.S. law (COPPA) requires your parent or guardian to give
          verified consent before we can collect anything else about you. {orgName ?? "Your coach"}{" "}
          will reach out to your parent or guardian directly to complete this — check back once
          that&apos;s done.
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="font-body text-xs text-steel uppercase tracking-wide underline"
        >
          Check again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-display uppercase text-lg font-bold mb-3">Health screening (PAR-Q+)</h2>
        <div className="space-y-4">
          {PAR_Q_QUESTIONS.map((question, i) => (
            <div key={question} className="border border-steel/20 p-3">
              <p className="font-body text-sm mb-2">
                {i + 1}. {question}
              </p>
              <div className="flex gap-2">
                {(["Yes", "No"] as const).map((label) => {
                  const value = label === "Yes";
                  const selected = answers[question] === value;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [question]: value }))}
                      className={`h-9 px-4 font-body text-sm border ${
                        selected ? "bg-rust border-rust text-graphite" : "border-steel/30 text-steel"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display uppercase text-lg font-bold mb-3">Liability waiver</h2>
        {waiverPdfUrl ? (
          <div className="border border-steel/20 p-4">
            <a
              href={waiverPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-body text-sm text-rust"
            >
              Open the waiver document (PDF) →
            </a>
            <label className="flex items-start gap-2 mt-4">
              <input
                type="checkbox"
                checked={waiverAccepted}
                onChange={(e) => setWaiverAccepted(e.target.checked)}
                className="mt-1"
              />
              <span className="font-body text-sm">
                I&apos;ve read and agree to the waiver document linked above.
              </span>
            </label>
          </div>
        ) : (
          <div className="border border-steel/20 p-4">
            <p
              tabIndex={0}
              role="region"
              aria-label="Liability waiver text"
              className="font-body text-xs text-steel whitespace-pre-wrap max-h-60 overflow-y-auto focus:outline-none focus:ring-1 focus:ring-rust"
            >
              {waiverText || DEFAULT_WAIVER_TEXT}
            </p>
            <label className="flex items-start gap-2 mt-4">
              <input
                type="checkbox"
                checked={waiverAccepted}
                onChange={(e) => setWaiverAccepted(e.target.checked)}
                className="mt-1"
              />
              <span className="font-body text-sm">I&apos;ve read and agree to the waiver above.</span>
            </label>
          </div>
        )}

        <label className="block mt-4">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Type your full legal name to sign
          </span>
          <input
            type="text"
            value={signedName}
            onChange={(e) => setSignedName(e.target.value)}
            className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
          />
        </label>
      </section>

      {error && (
        <p className="font-body text-sm text-rust" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        className="w-full h-12 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
      >
        {submitting ? "Saving…" : "Submit & continue"}
      </button>
    </div>
  );
}
