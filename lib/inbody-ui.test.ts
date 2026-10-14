import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canDeleteScan, parseScanRows, scanSeries, scanSummary } from "@/lib/inbody-series";
import { fitWithin } from "@/lib/image-resize";
import { USER_MONTHLY_CEILING, userMonthlyCeilingFor } from "@/lib/ai-usage";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const rows = parseScanRows([
  { id: "a", athlete_id: "c", uploaded_by: "c", scan_date: "2026-08-12", weight_lb: "182.4", skeletal_muscle_lb: "82.1", body_fat_mass_lb: "31.8", percent_body_fat: "17.4", lean_mass_lb: "150.6", photo_path: "g/c/a.jpg", source: "photo" },
  { id: "b", athlete_id: "c", uploaded_by: "k", scan_date: "2026-09-12", weight_lb: "180", skeletal_muscle_lb: null, body_fat_mass_lb: null, percent_body_fat: "16.1", lean_mass_lb: null, photo_path: null, source: "manual" },
]);

describe("the scans as rows and graphs", () => {
  it("numbers arrive as text from the database and become numbers; blanks stay blank", () => {
    expect(rows[0].weight_lb).toBe(182.4);
    expect(rows[1].skeletal_muscle_lb).toBeNull();
    expect(rows[1].source).toBe("manual");
    expect(parseScanRows(null)).toEqual([]);
  });
  it("one graph each for weight, percent body fat, muscle and fat mass, oldest first, only scans that have the number", () => {
    const series = scanSeries(rows);
    expect(series.map((s) => s.key)).toEqual(["weight", "percentFat", "muscle", "fatMass"]);
    expect(series[0].points).toEqual([{ date: "2026-08-12", value: 182.4 }, { date: "2026-09-12", value: 180 }]);
    expect(series[1].points).toHaveLength(2);
    expect(series[2].points).toEqual([{ date: "2026-08-12", value: 82.1 }]);
  });
  it("a list line says only what the scan has", () => {
    expect(scanSummary(rows[0])).toBe("182.4 lb · 17.4% fat · 82.1 lb muscle");
    expect(scanSummary(rows[1])).toBe("180 lb · 16.1% fat");
  });
  it("the person can delete their own scans; a coach only the ones they added", () => {
    expect(canDeleteScan(rows[0], "c")).toBe(true);
    expect(canDeleteScan(rows[0], "k")).toBe(false);
    expect(canDeleteScan(rows[1], "k")).toBe(true);
    expect(canDeleteScan(rows[1], "x")).toBe(false);
  });
});

describe("the photo is shrunk, never stretched", () => {
  it("fits inside 1600 on the longest side, keeping the shape", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe("the monthly cap is one easy number", () => {
  it("ten readings a month per person, in the one place the other photo limits live", () => {
    expect(USER_MONTHLY_CEILING.inbody_scan_parse).toBe(10);
    expect(userMonthlyCeilingFor("inbody_scan_parse")).toBe(10);
  });
});

describe("the review screen and the screens that hold it", () => {
  const flow = read("components/body/inbody-scan-flow.tsx");
  it("nothing is saved until the person presses Save, after seeing every number beside the photo", () => {
    expect(flow).toContain("Check the numbers before you save");
    expect(flow).toContain("Imported from a photo, check the numbers.");
    expect(flow).toContain('rpc("save_body_scan"');
    // reading never saves: the route is only called to read
    expect(flow.indexOf("/api/ai/parse-inbody-scan")).toBeLessThan(flow.indexOf('rpc("save_body_scan"'));
    expect(read("app/api/ai/parse-inbody-scan/route.ts")).not.toContain(".insert(");
  });
  it("the weigh-in box: on for the client themself, off for a coach, absent when a weigh-in already exists, and the database never overwrites", () => {
    expect(flow).toContain("useState(!coachAdding)");
    expect(flow).toContain("existingWeighIn != null ? (");
    expect(flow).toContain("p_use_as_weigh_in: useAsWeighIn && existingWeighIn == null && values.weightLb != null");
    expect(read("supabase/migrations/0375_inbody_scans.sql")).toContain("on conflict (athlete_id, logged_date) do nothing");
  });
  it("when reading is unavailable the same screen opens blank to type into, with the photo kept", () => {
    expect(flow).toContain("fill(EMPTY_SCAN);");
    expect(flow).toContain("You can type the numbers in and keep the photo.");
  });
  it("the photo is removed with the scan, and the person is told the weigh-in stays", () => {
    const section = read("components/body/inbody-scans-section.tsx");
    expect(section).toContain("Delete this scan and its photo? A weigh-in made from it stays in the weight log.");
    expect(section.indexOf('.remove([row.photo_path])')).toBeLessThan(section.indexOf('.from("body_scans").delete()'));
  });
  it("it is on the client's Home under their weight and on the coach's Progress tab", () => {
    expect(read("components/athlete/day-card.tsx")).toContain("<InbodyEntry athleteId={athleteId} groupId={groupId} />");
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).toContain("<InbodyScansSection athleteId={params.athleteId}");
  });
});
