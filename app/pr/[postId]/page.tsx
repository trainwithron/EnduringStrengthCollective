import { redirect } from "next/navigation";

// Superseded by the general workout-share page — every completed workout
// gets a shareable card now, not just PRs.
export default function PrShareRedirect({
  params,
}: {
  params: { postId: string };
}) {
  redirect(`/share/${params.postId}`);
}
