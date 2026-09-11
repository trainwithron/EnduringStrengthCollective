import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NewProgramForm } from "@/components/coach/new-program-form";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";

export default async function NewProgramPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
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

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="programs">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">New program</h1>
        <p className="font-body text-sm text-steel mt-2">
          A program is a training block — you&apos;ll add workouts to it next.
        </p>
      </div>

      <div className="max-w-lg">
        <NewProgramForm groupId={params.groupId} createdBy={user.id} />
      </div>
    </CoachDesktopShell>
  );
}
