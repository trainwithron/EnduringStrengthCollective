import { redirect } from "next/navigation";

// Merged into Resources (Referrals + Pro Shop combined) — kept as a
// redirect so any old bookmarked/shared link still lands somewhere real.
export default async function ReferralsRedirect(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  redirect(`/groups/${params.groupId}/resources?tab=referrals`);
}
