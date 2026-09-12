import { AlertTriangle } from "lucide-react";

// Real gap this closes: PAR-Q+ health-screening answers were collected
// at intake (client_intake.par_q_answers) and coach-readable per RLS,
// but never actually rendered anywhere in the app — a client could
// answer "yes" to the heart-condition/chest-pain screening questions
// and the coach would never see it. A "yes" to ANY PAR-Q+ question is
// itself the tool's own referral-trigger condition (that's the whole
// point of the standard 7-question screen: any "yes" means "talk to a
// doctor before starting"), so the flag below is just "does any answer
// exist and read true," not a separate clinical judgment call.
export function ParQAnswersPanel({
  answers,
}: {
  answers: { question: string; answer: boolean }[];
}) {
  if (answers.length === 0) return null;

  const flagged = answers.filter((a) => a.answer);

  return (
    <div>
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
        Health screening (PAR-Q+)
      </p>
      {flagged.length > 0 && (
        <div className="flex items-start gap-2 border border-rust/40 bg-rust/5 p-3 mb-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rust mt-0.5" />
          <p className="font-body text-xs text-rust">
            Answered &ldquo;Yes&rdquo; to {flagged.length} screening{" "}
            {flagged.length === 1 ? "question" : "questions"} — this client should consult a
            doctor before starting or continuing an exercise program.
          </p>
        </div>
      )}
      <div className="space-y-2">
        {answers.map((a, i) => (
          <div key={i} className="flex items-start justify-between gap-3 text-sm">
            <p className="font-body text-steel flex-1">{a.question}</p>
            <span
              className={`font-body font-medium shrink-0 ${a.answer ? "text-rust" : "text-chalk"}`}
            >
              {a.answer ? "Yes" : "No"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
