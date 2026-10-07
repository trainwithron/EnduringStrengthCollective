// Building a week of meal options for one client. Each day and slot gets up to three options from the library-first selection; across the week
//   - variety: a meal offered yesterday is moved down today (a favorite is never moved down), so the menu changes day to day;
//   - favorites repeat: a client's favorites stay among the options every day they fit;
//   - the FEATURED option (the one the client's card shows first) rotates among the options that are not favorites, never the same one two days running when another exists.
import { rankScore, selectOptions, type SelectionContext, type SlotSelection, isFavorite } from "@/lib/library-selection";
import type { SlotTarget } from "@/lib/meal-templates/tolerance";
import type { Slot } from "@/lib/meal-templates/types";
import type { ScaledMeal } from "@/lib/scaled-meal";

export interface WeekSlotSpec {
  id: string;
  slot: Slot;
  title: string;
  target: SlotTarget;
}

export interface WeekSlotResult {
  spec: WeekSlotSpec;
  options: ScaledMeal[];
  // Index into options of the meal featured on the client's card.
  featuredIndex: number;
  shortfall: number;
  leftOutForRules: number;
}

export type WeekPlanResult = Record<string, WeekSlotResult[]>;

export function pickFeatured(options: ScaledMeal[], ctx: SelectionContext, target: SlotTarget, featuredCount: Map<string, number>, lastFeatured: string | null): number {
  if (options.length === 0) return 0;
  const nonFavorite = options.map((m, i) => ({ m, i })).filter(({ m }) => !isFavorite(m, ctx.favorites));
  const pool = nonFavorite.length > 0 ? nonFavorite : options.map((m, i) => ({ m, i }));
  const notRepeat = pool.filter(({ m }) => m.key !== lastFeatured);
  const from = notRepeat.length > 0 ? notRepeat : pool;
  // The least featured so far; ties go to the better-ranked option.
  from.sort((a, b) => (featuredCount.get(a.m.key) ?? 0) - (featuredCount.get(b.m.key) ?? 0) || rankScore(a.m, target, ctx) - rankScore(b.m, target, ctx) || a.i - b.i);
  return from[0].i;
}

// dates: the days to build, in order. specsFor(date) gives that day's meal slots with their targets (a carb-cycling client has a different day on training days).
// ctx carries the client's variety settings (mixItUp, recentDays); rotateFeatured is false for a client who wants the same meals most days.
export function buildWeekPlan(args: { dates: string[]; specsFor: (date: string) => WeekSlotSpec[]; ctx: SelectionContext; rotateFeatured?: boolean }): WeekPlanResult {
  const { dates, specsFor } = args;
  const result: WeekPlanResult = {};
  const featuredCount = new Map<string, number>();
  const lastFeatured = new Map<string, string>();
  // Per meal key, how many days ago (within this build) it was last offered, merged over what the client was offered before this build.
  const offeredDaysAgo = new Map(args.ctx.recentlyOffered);
  dates.forEach((date, dayIndex) => {
    // Everything offered earlier in this build is one day older than it was yesterday.
    if (dayIndex > 0) for (const [k, d] of offeredDaysAgo) offeredDaysAgo.set(k, d + 1);
    const usedToday = new Set<string>();
    const offeredToday: string[] = [];
    result[date] = specsFor(date).map((spec) => {
      const ctx: SelectionContext = { ...args.ctx, recentlyOffered: offeredDaysAgo, excludeKeys: new Set([...(args.ctx.excludeKeys ?? []), ...usedToday]) };
      const sel: SlotSelection = selectOptions(spec.slot, spec.target, ctx);
      sel.options.forEach((m) => {
        usedToday.add(m.key);
        offeredToday.push(m.key);
      });
      const featuredIndex = args.rotateFeatured === false ? 0 : pickFeatured(sel.options, ctx, spec.target, featuredCount, lastFeatured.get(spec.id) ?? null);
      const featured = sel.options[featuredIndex];
      if (featured) {
        featuredCount.set(featured.key, (featuredCount.get(featured.key) ?? 0) + 1);
        lastFeatured.set(spec.id, featured.key);
      }
      return { spec, options: sel.options, featuredIndex, shortfall: sel.shortfall, leftOutForRules: sel.leftOutForRules };
    });
    // What was offered today is "0 days ago" for tomorrow's selection (it becomes 1 at the start of tomorrow's loop).
    for (const k of offeredToday) offeredDaysAgo.set(k, 0);
  });
  return result;
}
