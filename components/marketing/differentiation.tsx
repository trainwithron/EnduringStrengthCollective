const POINTS = [
  {
    label: "Fast, not bloated",
    body: "No feature you'll never touch buried three menus deep. If it's on the screen, it's there because coaches actually use it.",
  },
  {
    label: "Built around your program, not a template",
    body: "Progressions, per-client assignment, and a real desktop builder — designed for how programming actually gets written, not a generic form.",
  },
  {
    label: "One system, not five subscriptions",
    body: "Programming, booking, nutrition, payments, and your business numbers in one place — instead of stitching together a program app, a scheduler, and a spreadsheet.",
  },
];

export function Differentiation() {
  return (
    <section className="px-6 py-16 md:py-24 max-w-4xl mx-auto text-center">
      <h2 className="font-display uppercase text-3xl md:text-4xl font-bold">
        Built for coaches, not committees
      </h2>
      <p className="font-body text-steel mt-4 max-w-xl mx-auto">
        Most coaching software feels like it was designed for a sales demo.
        This one was built by watching a real coach run a real team, every
        day.
      </p>

      <div className="grid sm:grid-cols-3 gap-8 mt-12 text-left">
        {POINTS.map((p) => (
          <div key={p.label}>
            <p className="font-display uppercase text-lg font-bold text-rust">
              {p.label}
            </p>
            <p className="font-body text-chalk/80 text-sm mt-2 leading-relaxed">
              {p.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
