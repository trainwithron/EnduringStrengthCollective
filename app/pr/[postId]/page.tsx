import { redirect } from "next/navigation";

export const metadata = { title: "Pr" };

// Superseded by the general workout-share page — every completed workout
// gets a shareable card now, not just PRs.
export default async function PrShareRedirect(
  props: {
    params: Promise<{ postId: string }>;
  }
) {
  const params = await props.params;
  redirect(`/share/${params.postId}`);
}
