"use client";

import { useMemo, useState } from "react";
import type { SheetOptions } from "@/lib/team-sheet/load-sheet";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// shown Monday first
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// The team sheet download. A Day sheet is one workout of the program on a date; a Week sheet is one week of the program, its workouts placed in order on the training days chosen. Both are layout B (one sheet per rack),
// as a PDF to print or an Excel file. The program does not have to have dates: the coach says which workout, which week, and which days.
export function TeamSheetDownloadForm({ groupId, today, options }: { groupId: string; today: string; options: SheetOptions }) {
  const [mode, setMode] = useState<"day" | "week">("week");
  const [programId, setProgramId] = useState(options.programs[0]?.id ?? "");
  const program = options.programs.find((p) => p.id === programId) ?? options.programs[0];
  const [week, setWeek] = useState<number>(program?.weeks[0]?.week ?? 1);
  const weekRow = program?.weeks.find((w) => w.week === week) ?? program?.weeks[0];
  const [workoutId, setWorkoutId] = useState<string>(weekRow?.workouts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [days, setDays] = useState<number[]>(program && program.trainingDays.length > 0 ? program.trainingDays : [1, 3, 5]);
  const [perRack, setPerRack] = useState(4);
  const [unit, setUnit] = useState<"lb" | "kg">("lb");

  function chooseProgram(id: string) {
    const p = options.programs.find((x) => x.id === id);
    setProgramId(id);
    const first = p?.weeks[0];
    setWeek(first?.week ?? 1);
    setWorkoutId(first?.workouts[0]?.id ?? "");
    setDays(p && p.trainingDays.length > 0 ? p.trainingDays : [1, 3, 5]);
  }
  function chooseWeek(w: number) {
    setWeek(w);
    setWorkoutId(program?.weeks.find((x) => x.week === w)?.workouts[0]?.id ?? "");
  }

  const needed = mode === "week" ? (weekRow?.workouts.length ?? 0) : 0;
  const tooFewDays = mode === "week" && days.length < needed;
  const ready = !!program && !!date && (mode === "day" ? !!workoutId : days.length > 0 && !tooFewDays);
  const href = useMemo(
    () => (format: "xlsx" | "pdf") => {
      const common = { groupId, format, perRack: String(perRack), unit };
      const params = mode === "day" ? { ...common, mode, workoutId, date } : { ...common, mode, programId, week: String(week), start: date, days: [...days].sort((a, b) => a - b).join(",") };
      return `/api/team-sheet/download?${new URLSearchParams(params).toString()}`;
    },
    [groupId, perRack, unit, mode, workoutId, date, programId, week, days]
  );

  const field = "h-11 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust max-w-full";
  const button = "inline-flex items-center justify-center h-11 px-5 font-body text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust";
  const label = "font-body text-xs text-steel uppercase tracking-wide block mb-1";

  if (!program) {
    return <p className="font-body text-sm text-steel max-w-[60ch]">This group has no active program with workouts yet. Make or activate a program, and its workouts can be printed here.</p>;
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-5 max-w-xl">
      <fieldset>
        <legend className={label}>Sheet</legend>
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
        <p className="font-body text-xs text-steel mt-2">{mode === "day" ? "One page per rack for one workout." : "One page per rack for a whole week of the program: a block for each workout, so the athletes keep the same page all week."}</p>
      </fieldset>

      {options.programs.length > 1 && (
        <label className="block">
          <span className={label}>Program</span>
          <select id="team-sheet-program" value={program.id} onChange={(e) => chooseProgram(e.target.value)} className={field}>
            {options.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-wrap gap-4">
        <label className="block">
          <span className={label}>{mode === "day" ? "Week" : "Program week"}</span>
          <select id="team-sheet-week" value={weekRow?.week ?? week} onChange={(e) => chooseWeek(Number(e.target.value))} className={field}>
            {program.weeks.map((w) => (
              <option key={w.week} value={w.week}>
                Week {w.week} ({w.workouts.length} workout{w.workouts.length === 1 ? "" : "s"})
              </option>
            ))}
          </select>
        </label>
        {mode === "day" && (
          <label className="block">
            <span className={label}>Workout</span>
            <select id="team-sheet-workout" value={workoutId} onChange={(e) => setWorkoutId(e.target.value)} className={field}>
              {(weekRow?.workouts ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  Day {w.day} - {w.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className={label}>{mode === "day" ? "Date of the workout" : "Week starts (any day of that week)"}</span>
          <input id="team-sheet-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
      </div>

      {mode === "week" && (
        <fieldset>
          <legend className={label}>Training days</legend>
          <div className="flex flex-wrap gap-2">
            {DAY_ORDER.map((d) => (
              <label key={d} className={`h-11 px-3 flex items-center gap-2 border font-body text-sm cursor-pointer ${days.includes(d) ? "border-rust text-chalk" : "border-steel/40 text-steel"}`}>
                <input id={`team-sheet-day-${d}`} type="checkbox" checked={days.includes(d)} onChange={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))} className="accent-rust" />
                {DAY_NAMES[d]}
              </label>
            ))}
          </div>
          <p className={`font-body text-xs mt-2 ${tooFewDays ? "text-rust" : "text-steel"}`} role={tooFewDays ? "alert" : undefined}>
            {tooFewDays
              ? `Week ${weekRow?.week} has ${needed} workouts, so choose at least ${needed} days.`
              : `Week ${weekRow?.week} has ${needed} workout${needed === 1 ? "" : "s"}: Day 1 goes on the first chosen day, Day 2 on the next, and so on.`}
          </p>
        </fieldset>
      )}

      <div className="flex flex-wrap gap-4">
        <label className="block">
          <span className={label}>Athletes per rack</span>
          <select id="team-sheet-per-rack" value={perRack} onChange={(e) => setPerRack(Number(e.target.value))} className={field}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Weights in</span>
          <select id="team-sheet-unit" value={unit} onChange={(e) => setUnit(e.target.value as "lb" | "kg")} className={field}>
            <option value="lb">lb</option>
            <option value="kg">kg</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <a href={ready ? href("pdf") : undefined} aria-disabled={!ready} className={`${button} bg-rust text-graphite hover:opacity-90 ${ready ? "" : "opacity-40 pointer-events-none"}`}>
          Download PDF to print
        </a>
        <a href={ready ? href("xlsx") : undefined} aria-disabled={!ready} className={`${button} border border-steel/40 text-chalk hover:border-rust ${ready ? "" : "opacity-40 pointer-events-none"}`}>
          Download Excel
        </a>
      </div>
      <ul className="font-body text-xs text-steel space-y-1 list-disc pl-5">
        <li>Athletes are put on racks in last-name order, {perRack} to a rack. Names print as First L.</li>
        <li>Each box is one set. Athletes write the weight, such as 225, or 225x5 if the reps were not the plan, BW for body weight, and a dash if they skipped it.</li>
        <li>Timed and distance work (a plank, a carry) is not read yet: it goes in Notes.</li>
      </ul>
    </form>
  );
}
