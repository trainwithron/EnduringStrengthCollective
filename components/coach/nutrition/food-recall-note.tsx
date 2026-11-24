import { FOOD_DAY_LABELS } from "@/lib/goal-sheet";

// The goal sheet's 3-day eating recall, on the coach's nutrition view of a client who has logged nothing this week (Nov 23, Spotters keep up): something to go on before the
// first logged day. Read-only; nothing at all when there is no recall.

export interface FoodRecall {
  food_day_1: string | null;
  food_day_2: string | null;
  food_day_3: string | null;
  filled_at: string | null;
}

const DAY_FIELDS = ["food_day_1", "food_day_2", "food_day_3"] as const;

// The days with an answer, in the sheet's order (pure, tested).
export function recallDays(recall: FoodRecall | null | undefined): { label: string; text: string }[] {
  if (!recall) return [];
  return DAY_FIELDS.map((f) => ({ label: FOOD_DAY_LABELS[f], text: (recall[f] ?? "").trim() })).filter((d) => d.text !== "");
}

function filledOn(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function FoodRecallNote({ recall, firstName }: { recall: FoodRecall | null | undefined; firstName: string }) {
  const days = recallDays(recall);
  if (days.length === 0) return null;
  const on = filledOn(recall?.filled_at ?? null);
  return (
    <div className="mt-4 border border-steel/20 p-4" data-food-recall>
      <h3 className="font-display font-bold text-lg uppercase leading-none">What {firstName} said they ate</h3>
      <p className="font-body text-xs text-steel mt-1">
        Nothing logged this week yet. From their goal sheet{on ? ` (${on})` : ""}, the days before they filled it in.
      </p>
      <dl className="mt-3 space-y-2">
        {days.map((d) => (
          <div key={d.label}>
            <dt className="font-body text-xs uppercase tracking-wider text-steel">{d.label}</dt>
            <dd className="font-body text-sm text-chalk whitespace-pre-line break-words">{d.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
