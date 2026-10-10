import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { CoachCalendarPageBody } from "@/components/coach/calendar-page-body";

type SearchParams = Record<string, string | undefined>;

// A client's calendar, or a coach on a phone. A coach on a computer goes to the coach-level Calendar (/calendar, no group in the address); old links to this
// address keep working and carry their month, week and client with them.
export default async function GroupCalendarPage(props: { params: Promise<{ groupId: string }>; searchParams: Promise<SearchParams> }) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle();
    if (membership?.role === "coach" && !(await getEffectiveAthlete(params.groupId, user.id)).isActingAsOther && !(await prefersAthleteStyleView())) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string") qs.set(k, v);
      redirect(`/calendar${qs.size > 0 ? `?${qs.toString()}` : ""}`);
    }
  }
  return <CoachCalendarPageBody params={props.params} searchParams={props.searchParams} />;
}
