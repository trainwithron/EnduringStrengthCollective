import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { PrPromotionAnswerCard } from "@/components/pr-promotion/answer-card";
import { promotionSentence } from "@/lib/pr-promotion";

export const metadata = { title: "Pr promotion" };

// The page a client's notification opens when their coach asks to count a record from imported history. Only the client it is about can see it (row security); anyone else gets the plain not-found line.
export default async function PrPromotionPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/pr-promotion/${id}`)}`);

  const { data: promo } = await supabase
    .from("pr_promotions")
    .select("id, athlete_id, group_id, session_id, exercise_name, weight, status, athlete_sessions ( started_at, completed_at )")
    .eq("id", id)
    .eq("athlete_id", user.id)
    .maybeSingle();

  if (!promo) {
    return (
      <main className="min-h-screen bg-graphite text-chalk px-5 py-10 max-w-md mx-auto">
        <p className="font-body text-sm text-steel">We couldn&apos;t find that.</p>
        <Link href="/" className="inline-block mt-4 min-h-11 font-body text-sm text-rust underline underline-offset-2">
          Go home
        </Link>
      </main>
    );
  }

  const session = promo.athlete_sessions as unknown as { started_at: string | null; completed_at: string | null } | null;
  const when = (session?.completed_at ?? session?.started_at) as string | null;

  return (
    <main className="min-h-screen bg-graphite text-chalk px-5 py-10 max-w-md mx-auto">
      <h1 className="font-display font-bold text-2xl uppercase">Count this as a PR?</h1>
      <p className="font-body text-base mt-3">{promotionSentence(Number(promo.weight), promo.exercise_name as string, when)}</p>
      <p className="font-body text-sm text-steel mt-2">It keeps its original date.</p>
      {promo.status === "asked" ? (
        <PrPromotionAnswerCard promotionId={promo.id as string} groupId={promo.group_id as string} athleteId={user.id} />
      ) : (
        <p className="font-body text-sm text-steel mt-6">{promo.status === "agreed" ? "It counts as a PR now." : "You said not now."}</p>
      )}
      <Link href={`/groups/${promo.group_id}`} className="inline-block mt-6 min-h-11 font-body text-sm text-rust underline underline-offset-2">
        Back
      </Link>
    </main>
  );
}
