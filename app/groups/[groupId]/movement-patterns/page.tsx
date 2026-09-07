import { redirect } from "next/navigation";

// Movement Patterns moved inside the Exercise Library page as a tab.
export default function MovementPatternsRedirect({
  params,
}: {
  params: { groupId: string };
}) {
  redirect(`/groups/${params.groupId}/exercise-library`);
}
