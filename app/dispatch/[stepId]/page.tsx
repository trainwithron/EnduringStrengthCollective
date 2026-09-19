import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { DispatchStepActions } from "@/components/coach/dispatch-step-actions";

const GOAL_LABELS: Record<string, string> = {
  weight_loss: "Lose weight",
  body_recomp: "Body recomposition",
  muscle_gain: "Build muscle",
  bodybuilding: "Bodybuilding",
  powerbuilding_strongman: "Powerlifting / Strongman",
  endurance_event: "Training for an endurance event",
  custom: "Something else",
};

// org_calendar_spotter_trainer_dispatch_scoping_sept19.md — where a
// trainer lands from the "New client request" push notification.
// Authenticated (unlike the rest of this feature's prospect-facing
// surface) — a trainer already has a real account.
export default async function DispatchStepPage(props: { params: Promise<{ stepId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: step } = await supabase
    .from("org_trainer_dispatch_steps")
    .select(
      "id, trainer_id, status, expires_at, org_trainer_dispatch_requests ( prospect_name, requested_start_at, goal_type, goal_custom_label, message )"
    )
    .eq("id", params.stepId)
    .maybeSingle();

  if (!step || step.trainer_id !== user.id) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">This request isn&apos;t yours to view.</p>
      </main>
    );
  }

  const request = step.org_trainer_dispatch_requests as any;
  const isExpired = step.status === "pending" && new Date(step.expires_at).getTime() <= Date.now();
  const goalLabel =
    request.goal_type === "custom" && request.goal_custom_label
      ? request.goal_custom_label
      : GOAL_LABELS[request.goal_type] ?? request.goal_type;

  const { data: questions } = await supabase
    .from("org_trainer_dispatch_questions")
    .select("id, question, answer, created_at, answered_at")
    .eq("step_id", step.id)
    .order("created_at", { ascending: true });

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="max-w-sm w-full">
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust text-center">
          New client request
        </p>
        <h1 className="font-display font-bold text-2xl uppercase leading-tight mt-2 text-center">
          {request.prospect_name}
        </h1>
        <div className="mt-6 border border-steel/20 p-4 space-y-2">
          <p className="font-body text-sm">
            <span className="text-steel">Requested time:</span>{" "}
            {new Date(request.requested_start_at).toLocaleString()}
          </p>
          <p className="font-body text-sm">
            <span className="text-steel">Goal:</span> {goalLabel}
          </p>
          {request.message && (
            <p className="font-body text-sm">
              <span className="text-steel">Message:</span> {request.message}
            </p>
          )}
        </div>

        {(questions ?? []).length > 0 && (
          <div className="mt-4 space-y-2">
            {questions!.map((q) => (
              <div key={q.id} className="border border-steel/20 p-3">
                <p className="font-body text-xs text-steel uppercase tracking-wide">You asked</p>
                <p className="font-body text-sm mt-1">{q.question}</p>
                {q.answer ? (
                  <>
                    <p className="font-body text-xs text-steel uppercase tracking-wide mt-2">
                      {request.prospect_name} answered
                    </p>
                    <p className="font-body text-sm mt-1">{q.answer}</p>
                  </>
                ) : (
                  <p className="font-body text-xs text-steel mt-2">Waiting for a reply…</p>
                )}
              </div>
            ))}
          </div>
        )}

        {step.status === "accepted" ? (
          <p className="font-body text-sm text-positive mt-6 text-center">You accepted this request.</p>
        ) : step.status === "declined" ? (
          <p className="font-body text-sm text-steel mt-6 text-center">You declined this request.</p>
        ) : isExpired || step.status === "expired" ? (
          <p className="font-body text-sm text-steel mt-6 text-center">
            This offer expired and moved to the next trainer.
          </p>
        ) : (
          <DispatchStepActions stepId={step.id} />
        )}
      </div>
    </main>
  );
}
