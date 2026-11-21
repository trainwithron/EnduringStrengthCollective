import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { changeIsProgress, featuredMeasurement, formatTapeChange, latestMeasurement, measurementSaveMessage, type MeasurementRow } from "@/lib/body-measurements";

// Wave 2, P6 (Ron approved the Measures mockup, Nov 20): the Measurements screen.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const rows: MeasurementRow[] = [
  { date: "2026-08-04", waist: 35.5, hips: 40, chest: 41, arm: 14, thigh: null },
  { date: "2026-11-17", waist: 33.5, hips: 39, chest: 41.5, arm: 14.5, thigh: null },
];

describe("the screen's numbers", () => {
  it("opens on the first measurement that has readings (waist first), waist when there are none", () => {
    expect(featuredMeasurement(rows)).toBe("waist");
    expect(featuredMeasurement([{ date: "2026-01-01", waist: null, hips: null, chest: 40, arm: null, thigh: null }])).toBe("chest");
    expect(featuredMeasurement([])).toBe("waist");
  });
  it("the latest reading in the person's unit", () => {
    expect(latestMeasurement(rows, "waist", "in")).toEqual({ date: "2026-11-17", value: 33.5 });
    expect(latestMeasurement(rows, "waist", "cm")).toEqual({ date: "2026-11-17", value: 85.1 });
    expect(latestMeasurement(rows, "thigh", "in")).toBeNull();
  });
  it("a change carries its sign; only a smaller waist or hips reads as progress", () => {
    expect(formatTapeChange(-2)).toBe("−2.0");
    expect(formatTapeChange(0.5)).toBe("+0.5");
    expect(formatTapeChange(0)).toBe("0.0");
    expect(changeIsProgress("waist", -2)).toBe(true);
    expect(changeIsProgress("hips", -1)).toBe(true);
    expect(changeIsProgress("waist", 1)).toBe(false);
    expect(changeIsProgress("arm", -0.5)).toBe(false);
    expect(changeIsProgress("chest", 0.5)).toBe(false);
    expect(changeIsProgress("waist", null)).toBe(false);
  });
  it("a save before step 213 says measurements are not switched on yet", () => {
    expect(measurementSaveMessage("PGRST205 Could not find the table 'public.body_measurements' in the schema cache")).toBe("Measurements are not switched on yet.");
    expect(measurementSaveMessage('42P01 relation "public.body_measurements" does not exist')).toBe("Measurements are not switched on yet.");
    expect(measurementSaveMessage("23514 new row violates check constraint body_measurements_one_value")).toBe("Add at least one measurement.");
    expect(measurementSaveMessage("42501 permission denied")).toBe("That did not save. Try again.");
  });
});

describe("the screen", () => {
  it("renders the featured measurement, the other four and the add button, with no plain accent text", async () => {
    const { MeasurementsView } = await import("@/components/athlete/progress/measurements-view");
    const html = renderToStaticMarkup(createElement(MeasurementsView, { rows, unit: "in", athleteId: "a", groupId: "g" }));
    expect(html).toContain('data-featured-measurement="waist"');
    expect(html).toContain("33.5 in");
    expect(html).toContain("−2.0 in since Aug");
    expect(html).toContain("text-win");
    for (const label of ["Hips", "Chest", "Arm", "Thigh"]) expect(html).toContain(`>${label}<`);
    expect(html).toContain("Not measured yet");
    expect(html).toContain("Add today&#x27;s measurements");
    expect(html).toContain("Measure at the same spot each time, first thing in the morning.");
    expect(html).not.toMatch(/text-rust(?!-ink)[\s"]/);
  });
  it("the page: the client's own, a coach only while standing in as the client; back to My progress; the bar at the end", () => {
    const page = read("app/(coach)/groups/[groupId]/progress/measurements/page.tsx");
    expect(page).toContain("const effective = await getEffectiveAthlete(params.groupId, user.id);");
    expect(page).toContain('if (membership.role !== "athlete" && !effective.isActingAsOther) {');
    expect(page).toContain('const athleteId = membership.role === "athlete" ? user.id : effective.athleteId;');
    expect(page).toContain("href={`/groups/${params.groupId}/progress`}");
    expect(page).toContain("unit={tapeUnitFor(weightUnit)}");
    expect(page.indexOf("<MeasurementsView")).toBeLessThan(page.indexOf("<BottomTabBar"));
  });
  it("the form checks each number with the table's own ranges and saves one row a day", () => {
    const view = read("components/athlete/progress/measurements-view.tsx");
    expect(view).toContain("const parsed = parseTape(f, typed[f], unit);");
    expect(view).toContain("await saveMeasurements(createBrowserClient(), { athleteId, groupId, date, values });");
    expect(view).toContain("router.refresh();");
  });
});
