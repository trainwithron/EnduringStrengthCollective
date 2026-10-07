import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getCoachedGroups, groupsInOrgOf, type CoachedGroup } from "@/lib/coach-groups";
import { pickCoachAnchor } from "@/lib/coach-anchor";

// The coach's own pages (Business, Packages, Availability, Booking page, Leads, Zapier, Challenges, Hall of Fame...) belong to the coach, not to any one client. If
// the address names a ONE-ON-ONE client's own group (an old link, a bookmark, a link from that client's space), the page opens under the coach's usual group
// instead, so a client's name and group never become part of the coach's own pages (Ron, Oct 6). Pure decision; the wrapper below does the redirect.
export function coachWideRedirectTarget(groups: Pick<CoachedGroup, "id" | "name" | "kind" | "orgId">[], groupId: string, section: string): string | null {
  const here = groups.find((g) => g.id === groupId);
  if (!here || here.kind !== "one_on_one") return null;
  const anchor = pickCoachAnchor(groupsInOrgOf(groups as CoachedGroup[], groupId));
  if (!anchor || anchor.kind === "one_on_one" || anchor.id === groupId) return null;
  return `/groups/${anchor.id}/${section.replace(/^\/+/, "")}`;
}

// Call at the top of a coach-wide page. Anyone who is not a coach of that group (a client, a visitor) is left alone and the page's own checks apply.
export async function redirectOneOnOneToAnchor(groupId: string, section: string): Promise<void> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const groups = await getCoachedGroups(supabase, user.id);
  const target = coachWideRedirectTarget(groups, groupId, section);
  if (target) redirect(target);
}
