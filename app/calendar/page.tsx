import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { loadStartInputs, parseLastGroupCookie, pickStartGroup } from "@/lib/start-group";

// "/calendar" on its own (a bookmark, a typed address, a link without a group in it): a signed-in person goes to their own calendar in the group they use, a signed-out
// visitor goes to sign in first and comes back here. It used to be a "page not found" with a Sign in button, even while signed in.
export default async function CalendarRedirectPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=%2Fcalendar");

  const lastGroupId = parseLastGroupCookie((await cookies()).get("last_group")?.value);
  const membership = pickStartGroup(await loadStartInputs(supabase, user.id, lastGroupId));
  redirect(membership ? `/groups/${membership.group_id}/calendar` : "/");
}
