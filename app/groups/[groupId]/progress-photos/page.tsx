import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ProgressPhotoJournal } from "@/components/athlete/progress-photo-journal";

// Transformation Cards' private photo journal. Deliberately always the
// REAL signed-in user's own id — never the "View as Client" effective
// athlete used elsewhere in this app. A coach standing in for a client
// can log a set or check a habit on their behalf; uploading (or even
// browsing) someone else's private progress photos is a different kind
// of thing entirely, and this page just doesn't offer that path at all.
export default async function ProgressPhotosPage(
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

  if (!membership) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This group isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}/settings`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to settings
        </Link>
      </header>

      <section className="px-5 pt-6">
        <ProgressPhotoJournal athleteId={user.id} groupId={params.groupId} />
      </section>

      {membership.role === "athlete" && <BottomTabBar groupId={params.groupId} activeOverride="settings" />}
    </main>
  );
}
