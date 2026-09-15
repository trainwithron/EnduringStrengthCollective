// nutrition_spotter_scoping_sept15.md — the same relationship
// Programming Spotter has to the Program Builder: page-level, next to
// the meal planner. Deliberately a flag, never an auto-fix — the coach
// decides whether/how to regenerate, same "flag, don't act" discipline
// as every other Spotter in this app. Renders whatever findings the
// page's own checks produced (0-4 of them); the caller is responsible
// for running each check and building this list, same lightweight
// "no separate gather module" shape check #2 already shipped with.
export interface NutritionSpotterFinding {
  id: string;
  message: string;
}

export function NutritionSpotterPanel({ findings }: { findings: NutritionSpotterFinding[] }) {
  if (findings.length === 0) return null;

  return (
    <div className="border border-rust/40 bg-rust/5 p-4">
      <p className="font-body text-xs text-rust uppercase tracking-wide font-medium mb-2">Nutrition Spotter</p>
      <div className="space-y-2">
        {findings.map((f) => (
          <div key={f.id} className="flex items-start gap-2">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 bg-rust" />
            <p className="font-body text-sm text-chalk flex-1">{f.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
