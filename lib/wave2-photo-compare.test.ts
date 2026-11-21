import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compareStats, signedChange } from "@/lib/photo-compare";
import { PhotoCompare } from "@/components/athlete/progress/photo-compare";

// Wave 2, P5 (Ron approved the Compare mockup, Nov 20): two of the client's own progress photos side by side, with the gap, the weight change and the waist
// change under them. The photos stay the signed-in person's own (never "View as Client"), and the page only reads.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the numbers under the photos", () => {
  const weighIns = [{ date: "2026-08-03", weight: 190 }, { date: "2026-11-15", weight: 182 }];
  const waists = [{ date: "2026-08-01", weight: 35.5 }, { date: "2026-11-17", weight: 33.5 }];
  it("the gap, and the weight and waist change from the readings nearest each photo", () => {
    expect(compareStats("2026-08-04", "2026-11-17", weighIns, waists)).toEqual({ gap: "3 months apart", weightChange: -8, waistChange: -2 });
  });
  it("a change needs a reading near BOTH photos, and not the same reading twice", () => {
    expect(compareStats("2026-08-04", "2026-10-01", weighIns, waists)).toMatchObject({ weightChange: null, waistChange: null });
    expect(compareStats("2026-08-04", "2026-08-06", weighIns, [])).toMatchObject({ weightChange: null, waistChange: null });
  });
  it("a change is written with its sign", () => {
    expect(signedChange(-8, "lb")).toBe("−8 lb");
    expect(signedChange(0.5, "in")).toBe("+0.5 in");
    expect(signedChange(0, "lb")).toBe("0 lb");
  });
});

describe("the screen", () => {
  const photo = (id: string, takenDate: string) => ({ id, takenDate, storagePath: `g/p/${id}.jpg`, url: `https://x/${id}.jpg` });
  const base = { weighIns: [], waists: [], weightUnit: "lb" as const, addHref: "/groups/g/progress-photos" };
  it("opens on the first and the latest day, side by side, with a true privacy line", () => {
    const html = renderToStaticMarkup(createElement(PhotoCompare, { ...base, photos: [photo("a", "2026-08-04"), photo("b", "2026-09-10"), photo("c", "2026-11-17")] }));
    expect(html).toContain('src="https://x/a.jpg"');
    expect(html).toContain('src="https://x/c.jpg"');
    expect(html).not.toContain('src="https://x/b.jpg"');
    expect(html).toContain("Only you see these. Your coach sees a photo only if you share it.");
    // no pose data, so no Front / Side / Back; one photo a day, so no Photo 1 / 2 either
    expect(html).not.toMatch(/>(Front|Side|Back)</);
    expect(html).not.toContain("Photo 1");
  });
  it("a day with several photos offers Photo 1 / 2 to flip between them", () => {
    const html = renderToStaticMarkup(createElement(PhotoCompare, { ...base, photos: [photo("a", "2026-08-04"), photo("a2", "2026-08-04"), photo("c", "2026-11-17")] }));
    expect(html).toContain("Photo 1");
    expect(html).toContain("Photo 2");
  });
  it("fewer than two days of photos: a way to add one, not an empty compare", () => {
    const html = renderToStaticMarkup(createElement(PhotoCompare, { ...base, photos: [photo("a", "2026-08-04")] }));
    expect(html).toContain("data-photo-compare-empty");
    expect(html).toContain('href="/groups/g/progress-photos"');
  });
  it("the page reads only the signed-in person's own photos, and writes nothing", () => {
    const page = read("app/(coach)/groups/[groupId]/progress/photos/page.tsx");
    expect(page).toContain('.from("progress_photos").select("id, storage_path, taken_date, caption").eq("athlete_id", user.id)');
    expect(page).not.toContain("getEffectiveAthlete");
    expect(page).not.toMatch(/\.(insert|update|upsert|delete|remove|upload)\(/);
    expect(page).toContain('createSignedUrls(rows.map((r) => r.storage_path), 3600)');
  });
});
