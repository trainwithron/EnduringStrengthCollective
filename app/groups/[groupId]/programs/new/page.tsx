import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NewProgramForm } from "@/components/coach/new-program-form";

export default async function NewProgramPage({
  params,
}: {
  params: { groupId: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can create training programs.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to group
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">
          New program
        </h1>
        <p className="font-body text-sm text-steel mt-2">
          A program is a training block — you&apos;ll add workouts to it next.
        </p>
      </header>

      <NewProgramForm groupId={params.groupId} createdBy={user.id} />
    </main>
  );
}
