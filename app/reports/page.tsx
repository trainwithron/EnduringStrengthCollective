import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { ReportedContentPanel } from "@/components/feed/reported-content-panel";

export const metadata = { title: "Reported posts" };

// Reports that reached this person because nobody closer could handle them: the person reported was the group's only coach, so the organization's owner or admins are asked; with none of them either, the platform
// administrators. The database shows each person only the reports they may handle (never one about themselves), so for anyone else this page is simply empty. A group's own coaches see theirs at the top of the group's feed.
export default async function ReportsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-8 md:px-10">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Home
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">Reported posts</h1>
        <p className="font-body text-sm text-steel mt-2 mb-6 max-w-[60ch]">
          Reports waiting for you. You see what was reported and why, never who reported.
        </p>
        <ReportedContentPanel title="Open reports" />
        <p className="font-body text-sm text-steel">If nothing is listed above, nothing is waiting for you.</p>
      </div>
    </main>
  );
}
