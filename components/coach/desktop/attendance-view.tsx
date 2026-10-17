"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AttendanceAthlete } from "@/lib/attendance";

const SOURCE_LABEL = { kiosk: "Checked in", workout: "Finished a workout", session: "Attended a session" } as const;

// The grid: one row per athlete, one column per day, a dot where they were present (its tooltip says how), and how many days each was there. More than 31 days is shown as a list of counts only.
export function AttendanceView({ groupId, fromDay, toDay, athletes, dayKeys }: { groupId: string; fromDay: string; toDay: string; athletes: AttendanceAthlete[]; dayKeys: string[] }) {
  const router = useRouter();
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState(toDay);
  const showGrid = dayKeys.length <= 31;
  const presentOn = (day: string) => athletes.filter((a) => a.days[day]).length;

  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-3 mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/groups/${groupId}/attendance?from=${from}&to=${to}`);
        }}
      >
        <label className="font-body text-xs text-steel">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm" />
        </label>
        <label className="font-body text-xs text-steel">
          To (included)
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm" />
        </label>
        <button type="submit" className="h-11 px-4 border border-rust text-rust font-body text-sm font-medium">
          Show
        </button>
        <a href={`/api/coach/attendance-csv?groupId=${groupId}&from=${from}&to=${to}`} className="inline-flex items-center h-11 px-4 border border-steel/40 text-chalk font-body text-sm">
          Download (spreadsheet)
        </a>
      </form>

      {athletes.length === 0 ? (
        <p className="font-body text-sm text-steel">There are no athletes in this group yet.</p>
      ) : (
        <div className="overflow-x-auto border border-steel/20">
          <table className="font-body text-sm w-full">
            <thead>
              <tr className="text-left text-xs text-steel uppercase tracking-wide border-b border-steel/20">
                <th className="p-3 sticky left-0 bg-graphite">Athlete</th>
                <th className="p-3 text-right">Days</th>
                {showGrid &&
                  dayKeys.map((d) => (
                    <th key={d} className="p-1 text-center font-normal" title={d}>
                      {d.slice(8)}
                    </th>
                  ))}
                <th className="p-3">Last there</th>
              </tr>
            </thead>
            <tbody>
              {athletes.map((a) => (
                <tr key={a.athleteId} className="border-b border-steel/10 last:border-b-0">
                  <td className="p-3 sticky left-0 bg-graphite whitespace-nowrap">
                    {a.name}
                    {a.positionName && <span className="text-xs text-steel ml-2">{a.positionName}</span>}
                  </td>
                  <td className="p-3 text-right tabular-nums">{a.daysPresent}</td>
                  {showGrid &&
                    dayKeys.map((d) => (
                      <td key={d} className="p-1 text-center" title={a.days[d] ? a.days[d].map((s) => SOURCE_LABEL[s]).join(", ") : "Not there"}>
                        {a.days[d] ? <span aria-label={a.days[d].map((s) => SOURCE_LABEL[s]).join(", ")} className="inline-block w-2.5 h-2.5 rounded-full bg-rust" /> : <span aria-label="Not there" className="inline-block w-2.5 h-0.5 bg-steel/30 align-middle" />}
                      </td>
                    ))}
                  <td className="p-3 text-xs text-steel whitespace-nowrap">{a.lastPresent ?? "Not in this period"}</td>
                </tr>
              ))}
            </tbody>
            {showGrid && (
              <tfoot>
                <tr className="border-t border-steel/20 text-steel text-xs">
                  <td className="p-3 sticky left-0 bg-graphite">There each day</td>
                  <td />
                  {dayKeys.map((d) => (
                    <td key={d} className="p-1 text-center tabular-nums">
                      {presentOn(d)}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {!showGrid && <p className="font-body text-xs text-steel mt-2">A period longer than 31 days shows the number of days each athlete was there; the spreadsheet has every day.</p>}
    </div>
  );
}
