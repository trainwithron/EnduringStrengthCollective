import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { loadNutritionWeek, MAX_ROWS, type WeekClient, type WeekRow, type WeekStatus } from "@/lib/coach-nutrition-week";

const LABEL: Record<WeekStatus, string> = {
  nothing_logged: "Logged nothing",
  under: "Under target",
  over: "Over target",
  no_target: "No target set",
  tracking_off: "Food tracking off",
  on_track: "On track",
  logged: "Logged",
};
const TONE: Record<WeekStatus, string> = {
  nothing_logged: "text-rust",
  under: "text-rust",
  over: "text-rust",
  no_target: "text-steel",
  tracking_off: "text-steel",
  on_track: "text-chalk",
  logged: "text-chalk",
};

const num = (n: number | null, suffix = "") => (n == null ? "–" : `${n}${suffix}`);

function weightCell(r: WeekRow): string {
  if (r.weightChange == null) return "–";
  const sign = r.weightChange > 0 ? "+" : "";
  return `${sign}${r.weightChange} ${r.weightUnit}`;
}

// The coach's "This week" table (Release B3): every client's last seven days against their target, the ones that need the coach first. Read only.
export async function WeeklyNutritionSection({ groupId, clients }: { groupId: string; clients: WeekClient[] }) {
  const supabase = await createServerClient();
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const todayKey = dateKeyInZone(timezone);
  const week = await loadNutritionWeek(supabase, clients, todayKey);

  if (week.failed) {
    return (
      <p className="font-body text-sm text-rust" role="alert">
        Couldn&apos;t load this week&apos;s numbers, so nothing is shown rather than a table that could be wrong. Reload to try again.
      </p>
    );
  }
  if (week.rows.length === 0) return <p className="font-body text-sm text-steel">No clients yet.</p>;

  const counts = new Map<WeekStatus, number>();
  for (const r of week.rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

  return (
    <div>
      <p className="font-body text-sm text-steel mb-4 max-w-[70ch]">
        The last seven days for each client: what they logged, on the days they logged, against their target. The ones who need you come first. Open a client to see the detail.
      </p>
      {week.flagsUnreadable && (
        <p className="font-body text-xs text-steel mb-3" role="status">
          Couldn&apos;t check which clients have automatic suggestions switched off, so no one is marked under or over this time. Reload to try again.
        </p>
      )}
      <p className="font-body text-xs text-steel mb-3">
        {(["nothing_logged", "under", "over", "no_target", "tracking_off", "on_track", "logged"] as WeekStatus[])
          .filter((s) => (counts.get(s) ?? 0) > 0)
          .map((s) => `${counts.get(s)} ${LABEL[s].toLowerCase()}`)
          .join(" · ")}
      </p>
      <div className="overflow-x-auto border border-steel/20">
        <table className="w-full font-body text-sm tabular-nums">
          <caption className="sr-only">Each client&apos;s last seven days of eating against their target</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-steel border-b border-steel/20">
              <th scope="col" className="p-3 font-normal">Client</th>
              <th scope="col" className="p-3 font-normal">This week</th>
              <th scope="col" className="p-3 font-normal text-right">Days logged</th>
              <th scope="col" className="p-3 font-normal text-right">Avg calories</th>
              <th scope="col" className="p-3 font-normal text-right">Target</th>
              <th scope="col" className="p-3 font-normal text-right">Avg protein</th>
              <th scope="col" className="p-3 font-normal text-right">Weight</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel/15">
            {week.rows.map((r) => (
              <tr key={`${r.id}|${r.groupId}`}>
                <th scope="row" className="p-3 text-left font-normal">
                  <Link href={`/groups/${r.groupId}/nutrition?athleteId=${r.id}`} className="text-chalk underline underline-offset-2">
                    {r.fullName}
                  </Link>
                  {r.suggestionsOff && <span className="block text-xs text-steel">No automatic suggestions</span>}
                </th>
                {/* A client who is not judged (automatic suggestions off, or not a confirmed adult) reads "Logged 4 of 7 days" in the plain colour: no under or over, no percent, no red. */}
                <td className={`p-3 ${r.neutral ? "text-chalk" : TONE[r.status]}`}>
                  {r.status === "logged" ? `Logged ${r.daysLogged} of 7 days` : LABEL[r.status]}
                  {r.calorieGapPct != null && r.status !== "on_track" && <span className="text-xs"> ({r.calorieGapPct > 0 ? "+" : ""}{r.calorieGapPct}%)</span>}
                </td>
                <td className="p-3 text-right">{r.daysLogged} of 7</td>
                <td className="p-3 text-right">{num(r.avgCalories)}</td>
                <td className="p-3 text-right">{num(r.targetCalories)}</td>
                <td className="p-3 text-right">{r.avgProteinG == null ? "–" : `${r.avgProteinG} g`}{r.targetProteinG != null && r.avgProteinG != null ? <span className="text-xs text-steel"> / {r.targetProteinG}</span> : null}</td>
                <td className="p-3 text-right">{weightCell(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {week.total > MAX_ROWS && (
        <p className="font-body text-xs text-steel mt-3">
          Showing the {MAX_ROWS} who need you most, out of {week.total} clients. Open any client from the Clients tab to see the rest.
        </p>
      )}
    </div>
  );
}
