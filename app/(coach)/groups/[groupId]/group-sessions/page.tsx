import { redirect } from "next/navigation";

export const metadata = { title: "Group sessions" };

// Group sessions live on the Group calendar now, next to the group's events (layout audit, Oct 31: one page). This address keeps working: it opens the
// Group calendar showing group sessions across all the coach's groups, as this page did.
export default async function GroupSessionsMovedPage(props: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await props.params;
  redirect(`/groups/${groupId}/group-calendar?scope=all&show=sessions`);
}
