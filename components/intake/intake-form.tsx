"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { PAR_Q_QUESTIONS } from "@/lib/par-q-questions";
import { DEFAULT_WAIVER_TEXT } from "@/lib/intake-waiver";

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
            <p className="font-body text-xs text-steel whitespace-pre-wrap max-h-60 overflow-y-auto">
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
