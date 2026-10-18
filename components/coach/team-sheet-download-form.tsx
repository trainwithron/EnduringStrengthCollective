"use client";

import { useState } from "react";

// The team sheet download: a Day sheet or a Week sheet (layout B, one sheet per rack), as an Excel file or a printable PDF. The date is any day of the week for a Week sheet.
export function TeamSheetDownloadForm({ groupId, today }: { groupId: string; today: string }) {
  const [mode, setMode] = useState<"day" | "week">("week");
  const [date, setDate] = useState(today);
  const [perRack, setPerRack] = useState(4);
  const [unit, setUnit] = useState<"lb" | "kg">("lb");
  const href = (format: "xlsx" | "pdf") => `/api/team-sheet/download?${new URLSearchParams({ groupId, mode, date, format, perRack: String(perRack), unit }).toString()}`;
  const field = "h-11 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust";
  const button = "inline-flex items-center justify-center h-11 px-5 font-body text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust";
  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-5 max-w-xl">
      <fieldset>
        <legend className="font-body text-xs text-steel uppercase tracking-wide mb-2">Sheet</legend>
        <div className="flex gap-2">
          {(["day", "week"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`h-11 px-5 font-body text-sm border ${mode === m ? "bg-rust text-graphite border-rust" : "border-steel/40 text-chalk hover:border-rust"}`}
            >
              {m === "day" ? "Day sheet" : "Week sheet"}
            </button>
          ))}
        </div>
        <p className="font-body text-xs text-steel mt-2">{mode === "day" ? "One page per rack for one training day." : "One page per rack for the whole week: a block for each training day, so the athletes keep the same page all week."}</p>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide block mb-1">{mode === "day" ? "Day" : "Any day in the week"}</span>
          <input id="team-sheet-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide block mb-1">Athletes per rack</span>
          <select id="team-sheet-per-rack" value={perRack} onChange={(e) => setPerRack(Number(e.target.value))} className={field}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide block mb-1">Weights in</span>
          <select id="team-sheet-unit" value={unit} onChange={(e) => setUnit(e.target.value as "lb" | "kg")} className={field}>
            <option value="lb">lb</option>
            <option value="kg">kg</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <a href={href("pdf")} className={`${button} bg-rust text-graphite hover:opacity-90`}>
          Download PDF to print
        </a>
        <a href={href("xlsx")} className={`${button} border border-steel/40 text-chalk hover:border-rust`}>
          Download Excel
        </a>
      </div>
      <ul className="font-body text-xs text-steel space-y-1 list-disc pl-5">
        <li>Athletes are put on racks in last-name order, {perRack} to a rack. Names print as First L.</li>
        <li>Each box is one set. Athletes write the weight, such as 225, or 225x5 if the reps were not the plan, BW for body weight, and a dash if they skipped it.</li>
        <li>Timed and distance work (a plank, a carry) is not read yet: it goes in Notes.</li>
        <li>The workouts come from the team calendar. A day with no scheduled workout has no sheet.</li>
      </ul>
    </form>
  );
}
