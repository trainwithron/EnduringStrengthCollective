import Link from "next/link";
import { redirect } from "next/navigation";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { TeamSheetUpload } from "@/components/coach/team-sheet-upload";
import { TeamSheetSavedUploads, type SavedUpload } from "@/components/coach/team-sheet-saved-uploads";
import { SAVED_UPLOAD_COLUMNS } from "@/lib/team-sheet/reads";

export const metadata = { title: "Upload team sheets" };

// Read the filled sheets back in: upload, check on a review screen, save as workouts on their real days, and undo a whole upload.
export default async function TeamSheetUploadPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle();
  if (isReadFailure(membershipError)) return <LoadFailedPage />;
  if (membership?.role !== "coach") return <NoAccess>Only a coach of this group can upload its team sheets.</NoAccess>;

  const [{ data: group }, uploads] = await Promise.all([
    supabase.from("groups").select("name").eq("id", params.groupId).single(),
    supabase.from("team_sheet_batches").select(SAVED_UPLOAD_COLUMNS).eq("group_id", params.groupId).order("created_at", { ascending: false }).limit(30),
  ]);
  // Before the database update that adds the table, the page still works: there is simply nothing to list.
  const saved = uploads.error ? [] : ((uploads.data ?? []) as SavedUpload[]);

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="team-sheet">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Upload team sheets</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">Upload the filled Excel file, check what was read, and save it as workouts on their real days. Nothing is saved until you press Save, and a whole upload can be undone.</p>
        <p className="font-body text-xs text-steel mt-2">
          <Link href={`/groups/${params.groupId}/team-sheet`} className="text-rust underline underline-offset-4">
            Make a team sheet to print
          </Link>
        </p>
      </div>
      <TeamSheetUpload groupId={params.groupId} />
      <h2 className="font-display uppercase text-xl mt-10 mb-3">Saved uploads</h2>
      <TeamSheetSavedUploads groupId={params.groupId} uploads={saved} />
    </CoachDesktopShell>
  );
}
