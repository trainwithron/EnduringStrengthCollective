// Small, static renditions of real app screens for the landing page —
// built from this app's own tokens (font-display/font-body, rust/chalk/
// steel/surface) with plausible sample data, not screenshots. Purely
// decorative/non-interactive.

export function ProgramBuilderPreview() {
  const days = [
    {
      title: "Day 1 — Upper",
      rows: [
        { name: "Barbell Bench Press", sets: "4×6-8" },
        { name: "Barbell Bent Over Row", sets: "4×8-10" },
        { name: "Dumbbell Shoulder Press", sets: "3×10-12" },
      ],
    },
    {
      title: "Day 2 — Lower",
      rows: [
        { name: "Barbell Back Squat", sets: "4×5" },
        { name: "Romanian Deadlift", sets: "3×8-10" },
        { name: "Walking Lunge", sets: "3×12" },
      ],
    },
  ];
  return (
    <div className="p-5">
      <p className="font-display uppercase text-xs tracking-wide text-steel">
        Week 1
      </p>
      <div className="grid grid-cols-2 gap-3 mt-2">
        {days.map((d) => (
          <div key={d.title} className="bg-surface border border-steel/20 p-3">
            <p className="font-display uppercase text-sm font-bold text-chalk mb-2">
              {d.title}
            </p>
            <div className="space-y-1.5">
              {d.rows.map((r) => (
                <div
                  key={r.name}
                  className="flex items-center justify-between text-[11px] font-body"
                >
                  <span className="text-chalk/80 truncate pr-2">{r.name}</span>
                  <span className="text-rust font-medium shrink-0">{r.sets}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BusinessDashboardPreview() {
  const tiles = [
    { label: "Income this month", value: "$4,280" },
    { label: "Estimated MRR", value: "$3,150" },
    { label: "Roster size", value: "18" },
    { label: "Paying clients", value: "14" },
  ];
  return (
    <div className="p-5">
      <p className="font-display uppercase text-xs tracking-wide text-steel mb-2">
        Business
      </p>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="bg-surface border border-steel/20 p-3">
            <p className="font-display text-xl font-bold text-chalk">
              {t.value}
            </p>
            <p className="font-body text-[10px] text-steel uppercase tracking-wide mt-0.5">
              {t.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AthleteMobilePreview() {
  const items = [
    { name: "Barbell Back Squat", sets: "4×5", done: true },
    { name: "Romanian Deadlift", sets: "3×8-10", done: true },
    { name: "Walking Lunge", sets: "3×12", done: false },
    { name: "Cable Crunch", sets: "3×15", done: false },
  ];
  return (
    <div className="p-4">
      <p className="font-display uppercase text-lg font-bold text-chalk">
        Day 2 — Lower
      </p>
      <p className="font-body text-[11px] text-steel mt-0.5">Today&apos;s workout</p>
      <div className="space-y-2 mt-4">
        {items.map((it) => (
          <div
            key={it.name}
            className="flex items-center justify-between bg-surface border border-steel/20 px-3 py-2.5"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={
                  "w-3.5 h-3.5 rounded-full shrink-0 border " +
                  (it.done ? "bg-moss border-moss" : "border-steel/50")
                }
              />
              <span className="font-body text-[12px] text-chalk truncate">
                {it.name}
              </span>
            </div>
            <span className="font-body text-[11px] text-steel shrink-0">
              {it.sets}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 h-9 bg-rust text-graphite font-display uppercase text-xs font-bold flex items-center justify-center">
        Continue Workout
      </div>
    </div>
  );
}
