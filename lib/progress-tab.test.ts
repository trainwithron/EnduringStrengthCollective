import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");

// Ron's Progress tab: stats on top, the estimated maxes as cards, one overlay graph at the bottom; Logged workouts live in Overview with a search.
describe("the Progress tab", () => {
  it("stats are two groups of the same three numbers, the second with a period chosen on the word", () => {
    expect(page).toContain("<ProgressStats events={statEvents} prDates={prDateKeys} todayKey={progressToday} />");
    const stats = read("components/coach/progress/progress-stats.tsx");
    expect(stats).toContain("Lifetime stats");
    for (const word of ["Weekly", "Monthly", "Yearly"]) expect(stats).toContain(`label: "${word}"`);
  });
  it("the estimated maxes are cards (with a list switch, a weight or volume switch, Show all, a pin and an expanding chart), remembered on the coach's account", () => {
    expect(page).toContain("<TrainingMaxCards");
    expect(page).toContain("canPin={!selfView}");
    expect(page).toContain('supabase.from("coach_progress_prefs")');
    expect(page).toContain('.from("client_progress_pins")');
    const cards = read("components/coach/progress/training-max-cards.tsx");
    expect(cards).toContain("Show all (");
    expect(cards).toContain('.from("coach_progress_prefs").upsert(');
    expect(cards).toContain("Pin ${c.name} to the front");
    expect(cards).toContain("aria-expanded={open === c.name}");
    expect(cards).toContain("{hasGraph(series) ? <Sparkline points={series} /> : null}");
    expect(cards).toContain("{label}");
  });
  it("one overlay graph replaces the Body weight list and the Calorie target and Exercise blocks", () => {
    expect(page).toContain("<BodyOverlayChart weight={overlayWeight} target={calorieTrend} intake={overlayIntake} todayKey={progressToday} />");
    expect(page).not.toContain("Calorie target\n");
    expect(page).not.toContain("No calorie targets set yet.");
    expect(page).not.toContain("No weight logged yet.");
    expect(page).not.toContain("ExerciseProgression");
    const overlay = read("components/coach/progress/body-overlay-chart.tsx");
    expect(overlay).toContain("Body weight (left, lbs)");
    expect(overlay).toContain("Calorie target (right, cal)");
    expect(overlay).toContain("Logged intake (right, cal)");
  });
  it("Logged workouts left the Progress tab for Overview, where it has a search", () => {
    const at = page.indexOf("Logged workouts\n");
    expect(page.slice(page.lastIndexOf("<div data-tab=", at), at)).toContain('data-tab="overview">');
    expect(page).toContain("<LoggedSearch ");
    expect(page).toContain("No workouts match that search.");
    expect(read("components/coach/progress/logged-search.tsx")).toContain('method="get"');
  });
  it("nothing tells the coach that imported history is included", () => {
    for (const file of ["components/coach/progress/progress-stats.tsx", "components/coach/progress/training-max-cards.tsx", "components/coach/progress/body-overlay-chart.tsx"]) {
      expect(read(file).toLowerCase()).not.toContain("includes imported");
    }
    expect(page).not.toContain("Includes imported");
  });
  it("the program's training intent sets the starting graph, and the new reads join the first wait", () => {
    expect(page).toContain("defaultMetric(trainingIntent,");
    expect(page).toContain('.select("id, name, training_intent")');
    expect(page).toContain('supabase.rpc("client_daily_intake"');
  });
  it("the tables behind it are private to the coach and walled by organization", () => {
    const sql = read("supabase/migrations/0373_progress_tab.sql");
    expect(sql).toContain("coach_id = (select auth.uid())");
    expect(sql).toContain("org_wall_header");
    expect(sql).toContain("security invoker");
  });
});
