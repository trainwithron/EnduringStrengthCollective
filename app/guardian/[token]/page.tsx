import type { Metadata } from "next";
import { getGuardianView } from "@/lib/guardian-view";

// calorie_tracking_ux_research_and_plan.md — deliberately public, no
// auth check (a token is the whole access model, same as /share/ and
// /pr/) and deliberately no parent login/account, push notifications,
// or write access — a caregiver only ever sees today's status here.

export async function generateMetadata(
  props: { params: Promise<{ token: string }> }
): Promise<Metadata> {
  const params = await props.params;
  const view = await getGuardianView(params.token);
  if (!view) return { title: "Link not found" };
  return { title: `${view.athleteName}'s day — ${view.groupName}` };
}

const STATUS_LABEL: Record<string, string> = {
  ate_it: "Ate it ✓",
  modified: "Logged (modified)",
  skipped: "Skipped",
  not_logged: "Not yet logged",
};

const STATUS_DOT: Record<string, string> = {
  ate_it: "bg-moss",
  modified: "bg-moss",
  skipped: "bg-steel",
  not_logged: "bg-steel/40",
};

export default async function GuardianPage(
  props: { params: Promise<{ token: string }> }
) {
  const params = await props.params;
  const view = await getGuardianView(params.token);

  if (!view) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center max-w-sm">
          This link isn&apos;t available — it may have been revoked, or the athlete&apos;s coach hasn&apos;t
          shared one yet.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 py-10">
      <div className="max-w-md mx-auto">
        <p className="font-body text-xs text-steel uppercase tracking-wide">{view.groupName}</p>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-2">
          {view.athleteName}&apos;s day
        </h1>
        <p className="font-body text-sm text-steel mt-1">{view.dateLabel}</p>

        {view.proteinUnderTarget && (
          <div className="mt-5 border border-rust/40 bg-rust/5 p-3">
            <p className="font-body text-sm text-chalk">
              Protein has been running a bit low today compared to the plan.
            </p>
          </div>
        )}

        <div className="mt-6 divide-y divide-steel/15 border-y border-steel/15">
          {view.meals.length === 0 ? (
            <p className="font-body text-sm text-steel py-4">No meal plan set for today yet.</p>
          ) : (
            view.meals.map((meal) => (
              <div key={meal.title} className="py-3 flex items-center justify-between gap-3">
                <span className="font-body text-sm">{meal.title}</span>
                <span className="font-body text-xs text-steel flex items-center gap-1.5 shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[meal.status]}`} />
                  {STATUS_LABEL[meal.status]}
                </span>
              </div>
            ))
          )}
        </div>

        <p className="font-body text-[11px] text-steel mt-6">
          This is a read-only view shared by {view.athleteName}&apos;s coach — no login needed, and
          nothing here can be edited from this page.
        </p>
      </div>
    </main>
  );
}
