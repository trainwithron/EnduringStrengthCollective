import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { DispatchReplyForm } from "@/components/public/dispatch-reply-form";

// Public — where a prospect (no account) answers a trainer's
// "ask a question" step. Token-gated, same shape as guardian_links'
// own tokenized public access.
export default async function DispatchReplyPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const supabase = createServiceRoleClient();
  const { data: question } = await supabase
    .from("org_trainer_dispatch_questions")
    .select("id, question, answer, profiles:trainer_id ( full_name )")
    .eq("reply_token", params.token)
    .maybeSingle();

  if (!question) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">This link isn&apos;t valid.</p>
      </main>
    );
  }

  if (question.answer) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">You&apos;ve already answered this — thanks!</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="max-w-sm w-full">
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust text-center">
          {(question.profiles as any)?.full_name ?? "Your trainer"} asked
        </p>
        <p className="font-body text-lg mt-3 text-center">{question.question}</p>
        <DispatchReplyForm replyToken={params.token} />
      </div>
    </main>
  );
}
