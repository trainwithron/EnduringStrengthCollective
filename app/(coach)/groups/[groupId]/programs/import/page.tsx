import { redirect } from "next/navigation";

// The program import is a button on the Programs page now (Import program opens the file picker, then the import runs in a large panel there; program text is pasted into the AI builder box). This
// address stays so old links and bookmarks still land somewhere sensible: the Programs page.
export default async function ImportProgramPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  redirect(`/groups/${params.groupId}/programs`);
}
