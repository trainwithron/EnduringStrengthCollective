import { redirect } from "next/navigation";

export const metadata = { title: "Movement patterns" };

// Movement Patterns moved inside the Exercise Library page as a tab.
export default async function MovementPatternsRedirect(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  redirect(`/groups/${params.groupId}/exercise-library`);
}
