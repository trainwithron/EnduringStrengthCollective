import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { getCoachedGroups } from "@/lib/coach-groups";
import { pickCoachAnchor } from "@/lib/coach-anchor";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { loadStartInputs, parseLastGroupCookie, pickStartGroup } from "@/lib/start-group";
import { CoachCalendarPageBody } from "@/components/coach/calendar-page-body";

type SearchParams = Record<string, string | undefined>;

// The coach's Calendar: the whole schedule (every one-on-one session and every group item), with no group in the address, like /clients and /programs. The page
// needs some group of theirs to read its settings from; which one does not change what it shows, because the schedule is the coach's own. Anyone who is not a
// coach (a bookmark, a typed address) goes to their own calendar in the group they use, as before; a coach on a phone keeps the group calendar.
export default async function CoachCalendarRoute(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=%2Fcalendar");

  const anchor = pickCoachAnchor(await getCoachedGroups(supabase, user.id));
  if (anchor) {
    if (await prefersAthleteStyleView()) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string") qs.set(k, v);
      redirect(`/groups/${anchor.id}/calendar${qs.size > 0 ? `?${qs.toString()}` : ""}`);
    }
    return <CoachCalendarPageBody coachLevel params={Promise.resolve({ groupId: anchor.id })} searchParams={props.searchParams} />;
  }

  const lastGroupId = parseLastGroupCookie((await cookies()).get("last_group")?.value);
  const membership = pickStartGroup(await loadStartInputs(supabase, user.id, lastGroupId));
  redirect(membership ? `/groups/${membership.group_id}/calendar` : "/");
}
