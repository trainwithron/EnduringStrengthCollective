import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { goalStatusWords } from "@/lib/goal-types";
import { inOwnPersonalSpace } from "@/lib/personal-space";
import { GoalsForm } from "@/components/shared/goals-form";
import { sheetAnswers } from "@/components/shared/goal-sheet-fields";
import { EMPTY_GOAL_SHEET, GOAL_SHEET_COLUMNS, goalSheetWaitingOnClient, type GoalSheetRow } from "@/lib/goal-sheet";
import { goalLabel } from "@/lib/goals-all-in-one";
import type { SubGoalStatus, SubGoalView } from "@/lib/sub-goals";

export const metadata = { title: "Your goals" };

// "Your goals" (Ron, Nov 23: goals, all in one): the client's main goal, smaller goals and Ron's 7 goal sheet questions on one page, sent to their coach with one button.
// The client always sets/owns the goal (goal_date_aware_nutrition_and_programming_idea.md): what they choose is proposed and the coach confirms it; a goal the coach suggested is
// already filled in, theirs to keep (that confirms it), change (it goes back to the coach) or say not now to. Answers already saved show filled in. ?edit=1 ("Update my goal",
// the coach's notice) opens the same page.
export default async function GoalPage(props: { params: Promise<{ groupId: string }>; searchParams?: Promise<{ edit?: string }> }) {
  const params = await props.params;
  await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (isReadFailure(membershipError)) return <LoadFailedPage />;

  // A coach in their OWN personal space sets their own goal there.
  if (membership?.role !== "athlete" && !(await inOwnPersonalSpace(supabase, params.groupId, user.id))) {
    return <NoAccess>This page is for clients to set their own goals.</NoAccess>;
  }

  const [{ data: goals }, { data: subGoalRows }, { data: goalSheetRow }, { data: coachRows }] = await Promise.all([
    supabase
      .from("client_goals")
      .select("id, goal_type, custom_label, target_date, priority_note, status, created_by, created_at, event_type, event_priority, weight_class_flag")
      .eq("athlete_id", user.id)
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false }),
    supabase.from("client_sub_goals").select("id, title, target_date, proposed_by, status").eq("athlete_id", user.id).eq("group_id", params.groupId).order("created_at", { ascending: true }),
    // before step 197 there is no such table: read as none, and the questions show empty
    supabase.from("client_goal_sheets").select(GOAL_SHEET_COLUMNS).eq("athlete_id", user.id).eq("group_id", params.groupId).maybeSingle(),
    supabase.from("group_memberships").select("profile_id, profiles ( full_name )").eq("group_id", params.groupId).eq("role", "coach"),
  ]);
  const subGoals: SubGoalView[] = ((subGoalRows ?? []) as any[]).map((r: any) => ({ id: r.id as string, title: r.title as string, targetDate: (r.target_date as string | null) ?? null, proposedBy: r.proposed_by as string, status: r.status as SubGoalStatus }));
  const sheet = (goalSheetRow as GoalSheetRow | null) ?? null;

  // The coach the button sends to: the one who sent the goals, else the group's first coach.
  const coaches = ((coachRows ?? []) as any[]).map((c: any) => ({ id: c.profile_id as string, name: ((Array.isArray(c.profiles) ? c.profiles[0]?.full_name : c.profiles?.full_name) as string | null) ?? "" }));
  const coach = coaches.find((c) => c.id === sheet?.requested_by) ?? coaches.find((c) => c.id !== user.id) ?? null;
  const coachFirst = coach?.name.trim().split(/\s+/)[0] || "your coach";

  const current = (goals ?? [])[0] ?? null;
  const history = (goals ?? []).slice(1);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link href={`/groups/${params.groupId}/more`} className="min-h-11 inline-flex items-center font-body text-xs text-steel uppercase tracking-wide">
          &larr; More
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">Your goals</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Your main goal, any smaller goals, and a few questions about you. {coachFirst === "your coach" ? "Your coach" : coachFirst} sees it and confirms your goal before it changes
          anything.
        </p>
        {goalSheetWaitingOnClient(sheet) && <p className="font-body text-sm text-rust-ink mt-2">{coachFirst === "your coach" ? "Your coach" : coachFirst} asked you to fill this in.</p>}
      </header>

      <section id="goal-sheet" className="px-5 pt-6 max-w-xl scroll-mt-4">
        <GoalsForm
          groupId={params.groupId}
          athleteId={user.id}
          viewer="client"
          viewerId={user.id}
          otherFirstName={coachFirst}
          goal={
            current
              ? {
                  id: current.id as string,
                  goalType: current.goal_type as string,
                  customLabel: (current.custom_label as string | null) ?? null,
                  targetDate: (current.target_date as string | null) ?? null,
                  eventType: (current.event_type as string | null) ?? null,
                  eventPriority: (current.event_priority as string | null) ?? null,
                  weightClassFlag: !!current.weight_class_flag,
                  status: current.status as string,
                  createdBy: (current.created_by as string | null) ?? null,
                }
              : null
          }
          subGoals={subGoals}
          sheet={sheet ? sheetAnswers(sheet) : EMPTY_GOAL_SHEET}
        />

        {history.length > 0 && (
          <div className="mt-10">
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">Earlier goals</h2>
            <div className="divide-y divide-steel/15">
              {history.map((g) => (
                <div key={g.id as string} className="py-2">
                  <p className="font-body text-sm">{goalLabel(g.goal_type as string, g.custom_label as string | null)}</p>
                  <p className="font-body text-xs text-steel">
                    {goalStatusWords(g.status as string) || (g.status as string)} · {new Date(g.created_at as string).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
