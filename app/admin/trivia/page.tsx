import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { TriviaReviewPanel } from "@/components/admin/trivia-review-panel";

// Platform-admin-only review queue for the trivia flash-round content
// bank (custom_shape_theming_idea.md) — same gate/shell pattern as
// app/admin/support/page.tsx.
export default async function AdminTriviaPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_platform_admin) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">You don&apos;t have access to this page.</p>
      </main>
    );
  }

  const { data: pendingRows } = await supabase
    .from("trivia_questions")
    .select("id, statement, correct_answer, status")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  const { count: approvedCount } = await supabase
    .from("trivia_questions")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved");

  const questions = (pendingRows ?? []).map((q) => ({
    id: q.id,
    statement: q.statement,
    correctAnswer: q.correct_answer,
    status: q.status as "pending",
  }));

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-10 max-w-2xl mx-auto">
      <h1 className="font-display font-bold text-3xl uppercase leading-none">Trivia Review</h1>
      <p className="font-body text-sm text-steel mt-2">
        {approvedCount ?? 0} questions live in the flash-round bank.
      </p>
      <div className="mt-6">
        <TriviaReviewPanel initialQuestions={questions} />
      </div>
    </main>
  );
}
